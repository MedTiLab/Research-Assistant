import express from 'express';
import { ComputeNode, loadAllNodes, loadNodeConfig, saveNode, deleteNode, setActiveNode, getActiveNode, isComputeConfigured } from '../compute-node.js';
import { parseLinuxFreeMemoryLine } from '../utils/computeMonitoring.js';

const router = express.Router();

function createComputeRequestAbortContext(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!res.writableEnded && !controller.signal.aborted) {
      controller.abort(new Error('Compute request connection closed'));
    }
  };
  req.once('aborted', abort);
  res.once('close', abort);
  return {
    signal: controller.signal,
    dispose() {
      req.removeListener('aborted', abort);
      res.removeListener('close', abort);
    },
  };
}

// ─── Multi-node CRUD ───

// GET /api/compute/nodes - Get all nodes (passwords masked)
router.get('/nodes', async (req, res) => {
  try {
    const config = await loadAllNodes();
    const nodes = (config.nodes || []).map(n => ({
      ...n,
      password: undefined,
      hasPassword: !!n.password,
    }));
    res.json({ nodes, activeNodeId: config.activeNodeId });
  } catch (error) {
    console.error('Error loading compute nodes:', error);
    res.status(500).json({ error: 'Failed to load nodes' });
  }
});

// POST /api/compute/nodes - Add a new node
router.post('/nodes', async (req, res) => {
  try {
    const { name, host, user, authType, key, password, workDir, type, slurm, port } = req.body;
    if (!host?.trim()) return res.status(400).json({ error: 'Host is required' });
    if (!user?.trim()) return res.status(400).json({ error: 'Username is required' });
    const parsedPort = parseInt(port) || 22;
    if (parsedPort < 1 || parsedPort > 65535) return res.status(400).json({ error: 'Port must be between 1 and 65535' });

    const result = await ComputeNode.configure({
      name: name?.trim() || host.trim(),
      host: host.trim(),
      user: user.trim(),
      key: authType === 'key' ? key : undefined,
      password: authType === 'password' ? password : undefined,
      workDir: (workDir || '~').trim(),
      type: type || 'direct',
      slurm: slurm || undefined,
      port: parsedPort,
      activate: false,
    });

    res.json({ success: true, message: result });
  } catch (error) {
    console.error('Error adding compute node:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/compute/nodes/:id - Update a node
router.put('/nodes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await loadNodeConfig(id);
    const { name, host, user, authType, key, password, workDir, type, slurm, port } = req.body;
    if (port !== undefined) {
      const parsedPort = parseInt(port);
      if (!parsedPort || parsedPort < 1 || parsedPort > 65535) return res.status(400).json({ error: 'Port must be between 1 and 65535' });
    }

    const updated = {
      ...existing,
      name: name?.trim() || existing.name,
      host: host?.trim() || existing.host,
      user: user?.trim() || existing.user,
      port: port !== undefined ? (parseInt(port) || 22) : (existing.port || 22),
      workDir: (workDir || existing.workDir || '~').trim(),
      type: type || existing.type || 'direct',
    };

    // Update auth
    if (authType === 'key') {
      delete updated.password;
      if (key) {
        if (key.includes('BEGIN')) {
          // key content - will be handled by configure, but here we save directly
          const fs = await import('fs/promises');
          const path = await import('path');
          const os = await import('os');
          const keyPath = path.default.join(os.default.homedir(), '.ssh', `compute_${id}_key`);
          await fs.default.mkdir(path.default.dirname(keyPath), { recursive: true });
          await fs.default.writeFile(keyPath, key + '\n', { mode: 0o600 });
          updated.keyPath = keyPath;
        } else {
          updated.keyPath = key;
        }
      }
    } else if (authType === 'password') {
      delete updated.keyPath;
      if (password) {
        updated.password = password;
      }
      // If no new password provided, keep existing
    }

    // Slurm config
    if (type === 'slurm' && slurm) {
      updated.slurm = slurm;
    } else if (type !== 'slurm') {
      delete updated.slurm;
    }

    await saveNode(updated);
    res.json({ success: true, message: `Node "${updated.name}" updated` });
  } catch (error) {
    console.error('Error updating compute node:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/compute/nodes/:id - Delete a node
router.delete('/nodes/:id', async (req, res) => {
  try {
    await deleteNode(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting compute node:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/compute/nodes/:id/active - Set as active node
router.post('/nodes/:id/active', async (req, res) => {
  try {
    const node = await setActiveNode(req.params.id);
    res.json({ success: true, node: { ...node, password: undefined, hasPassword: !!node.password } });
  } catch (error) {
    console.error('Error setting active node:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/compute/active - Select the local machine or a configured remote node.
router.post('/active', async (req, res) => {
  try {
    const nodeId = req.body?.nodeId || null;
    const node = await setActiveNode(nodeId);
    res.json({
      success: true,
      activeNodeId: node?.id || null,
      node: node ? { ...node, password: undefined, hasPassword: !!node.password } : null,
    });
  } catch (error) {
    console.error('Error setting active compute resource:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/compute/nodes/:id/test - Test connection to a node
router.post('/nodes/:id/test', async (req, res) => {
  const abortContext = createComputeRequestAbortContext(req, res);
  try {
    const output = await ComputeNode.run({
      nodeId: req.params.id,
      command: 'echo "=== Connection OK ===" && uname -a && echo "=== GPU Info ===" && (nvidia-smi 2>/dev/null || echo "No GPU detected") && echo "=== Slurm ===" && (sinfo --version 2>/dev/null || echo "No Slurm")',
      skipSync: true,
      signal: abortContext.signal,
      timeoutMs: 60_000,
    });
    res.json({ success: true, output });
  } catch (error) {
    console.error('Error testing compute node:', error);
    if (!res.destroyed) res.json({ success: false, error: error.message });
  } finally {
    abortContext.dispose();
  }
});

// POST /api/compute/nodes/:id/sync - Sync code
router.post('/nodes/:id/sync', async (req, res) => {
  const abortContext = createComputeRequestAbortContext(req, res);
  try {
    const { direction = 'up', cwd, files } = req.body;
    if (!cwd) return res.status(400).json({ error: 'Working directory (cwd) is required' });

    const output = await ComputeNode.sync({
      nodeId: req.params.id,
      direction,
      cwd,
      files: files || [],
      signal: abortContext.signal,
    });
    res.json({ success: true, output });
  } catch (error) {
    console.error('Error syncing compute node:', error);
    if (!res.destroyed) res.status(500).json({ success: false, error: error.message });
  } finally {
    abortContext.dispose();
  }
});

// POST /api/compute/nodes/:id/run - Run command on node
router.post('/nodes/:id/run', async (req, res) => {
  const abortContext = createComputeRequestAbortContext(req, res);
  try {
    const { command, cwd, skipSync = false } = req.body;
    if (!command?.trim()) return res.status(400).json({ error: 'Command is required' });

    const output = await ComputeNode.run({
      nodeId: req.params.id,
      command: command.trim(),
      cwd: cwd || undefined,
      skipSync,
      signal: abortContext.signal,
    });
    res.json({ success: true, output });
  } catch (error) {
    console.error('Error running command:', error);
    if (!res.destroyed) res.status(500).json({ success: false, error: error.message });
  } finally {
    abortContext.dispose();
  }
});

// GET /api/compute/nodes/:id/monitor - Get GPU and CPU usage
router.get('/nodes/:id/monitor', async (req, res) => {
  try {
    const monitorCmd = [
      'echo "===GPU_START==="',
      '(nvidia-smi --query-gpu=index,name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits 2>/dev/null || echo "NO_GPU")',
      'echo "===GPU_END==="',
      'echo "===CPU_START==="',
      'nproc 2>/dev/null || echo "0"',
      'echo "---"',
      '(cat /proc/loadavg 2>/dev/null || uptime | sed "s/.*load average[s]*: //" | cut -d, -f1)',
      'echo "---"',
      '(free -m 2>/dev/null | grep Mem || echo "Mem: 0 0 0 0 0 0")',
      'echo "===CPU_END==="',
    ].join(' && ');

    const output = await ComputeNode.run({
      nodeId: req.params.id,
      command: monitorCmd,
      skipSync: true,
    });

    const gpuSection = (output.match(/===GPU_START===\n([\s\S]*?)===GPU_END===/) || [])[1]?.trim() || '';
    const cpuSection = (output.match(/===CPU_START===\n([\s\S]*?)===CPU_END===/) || [])[1]?.trim() || '';

    const gpus = [];
    if (gpuSection && gpuSection !== 'NO_GPU') {
      for (const line of gpuSection.split('\n')) {
        const parts = line.split(',').map((s) => s.trim());
        if (parts.length >= 7) {
          gpus.push({
            index: parseInt(parts[0]) || 0,
            name: parts[1] || 'Unknown',
            gpuUtil: parseFloat(parts[2]) || 0,
            memUtil: parseFloat(parts[3]) || 0,
            memUsedMB: parseFloat(parts[4]) || 0,
            memTotalMB: parseFloat(parts[5]) || 0,
            tempC: parseFloat(parts[6]) || 0,
            powerW: parseFloat(parts[7]) || 0,
          });
        }
      }
    }

    const cpuParts = cpuSection.split('---').map((s) => s.trim());
    const cpuCount = parseInt(cpuParts[0]) || 0;
    const loadAvg = parseFloat(cpuParts[1]) || 0;
    const memLine = cpuParts[2] || '';
    const memorySnapshot = parseLinuxFreeMemoryLine(memLine) || {
      memTotalMB: 0,
      memUsedMB: 0,
      memAvailableMB: 0,
      memUtilPercent: 0,
      memLabel: 'System Memory',
      memDisplayMode: 'used',
    };

    res.json({
      success: true,
      gpus,
      cpu: {
        cores: cpuCount,
        loadAvg,
        utilPercent: cpuCount > 0 ? Math.min(100, Math.round((loadAvg / cpuCount) * 100)) : 0,
        ...memorySnapshot,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Error monitoring compute node:', error);
    res.json({ success: false, error: error.message, gpus: [], cpu: null, timestamp: Date.now() });
  }
});

// ─── Slurm endpoints ───

// GET /api/compute/nodes/:id/slurm/info - Get partition info
router.get('/nodes/:id/slurm/info', async (req, res) => {
  try {
    const partitions = await ComputeNode.sinfo({ nodeId: req.params.id });
    res.json({ success: true, partitions });
  } catch (error) {
    console.error('Error getting sinfo:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/compute/nodes/:id/slurm/queue - Get job queue
router.get('/nodes/:id/slurm/queue', async (req, res) => {
  try {
    const jobs = await ComputeNode.squeue({ nodeId: req.params.id });
    res.json({ success: true, jobs });
  } catch (error) {
    console.error('Error getting squeue:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/compute/nodes/:id/slurm/salloc - Interactive GPU allocation
router.post('/nodes/:id/slurm/salloc', async (req, res) => {
  try {
    const { partition, time, gpus, account, command } = req.body;
    const output = await ComputeNode.salloc({
      nodeId: req.params.id,
      partition, time, gpus, account, command,
    });
    res.json({ success: true, output });
  } catch (error) {
    console.error('Error running salloc:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/compute/nodes/:id/slurm/sbatch - Submit batch job
router.post('/nodes/:id/slurm/sbatch', async (req, res) => {
  try {
    console.log('[DEBUG] sbatch req.body keys:', Object.keys(req.body || {}), 'rawScript length:', req.body?.rawScript?.length, 'script length:', req.body?.script?.length);
    const { rawScript, script, partition, time, gpus, account, jobName } = req.body;
    if (!rawScript?.trim() && !script?.trim()) return res.status(400).json({ error: 'Script content is required' });

    const output = await ComputeNode.sbatch({
      nodeId: req.params.id,
      rawScript: rawScript?.trim() || undefined,
      script: script?.trim() || undefined,
      partition, time, gpus, account, jobName,
    });
    res.json({ success: true, output });
  } catch (error) {
    console.error('Error submitting sbatch:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/compute/nodes/:id/slurm/cancel/:jobId - Cancel a job
router.post('/nodes/:id/slurm/cancel/:jobId', async (req, res) => {
  try {
    const output = await ComputeNode.scancel({
      nodeId: req.params.id,
      jobId: req.params.jobId,
    });
    res.json({ success: true, output });
  } catch (error) {
    console.error('Error cancelling job:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Backward-compatible endpoints (use active node) ───

router.get('/config', async (req, res) => {
  try {
    const node = await getActiveNode();
    if (!node) {
      return res.json({ configured: false, host: '', user: '', workDir: '~', authType: 'key', keyPath: '', hasPassword: false });
    }
    res.json({
      configured: !!(node.host && node.user && (node.keyPath || node.password)),
      host: node.host || '',
      user: node.user || '',
      workDir: node.workDir || '~',
      authType: node.keyPath ? 'key' : (node.password ? 'password' : 'key'),
      keyPath: node.keyPath || '',
      hasPassword: !!node.password,
      type: node.type || 'direct',
      nodeId: node.id,
    });
  } catch (error) {
    console.error('Error loading compute config:', error);
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

router.post('/configure', async (req, res) => {
  try {
    const { host, user, authType, key, password, workDir } = req.body;
    if (!host?.trim()) return res.status(400).json({ error: 'Host is required' });
    if (!user?.trim()) return res.status(400).json({ error: 'Username is required' });

    const message = await ComputeNode.configure({
      host: host.trim(),
      user: user.trim(),
      key: authType === 'key' ? key : undefined,
      password: authType === 'password' ? password : undefined,
      workDir: (workDir || '~').trim(),
    });
    res.json({ success: true, message });
  } catch (error) {
    console.error('Error saving compute config:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/test', async (req, res) => {
  const abortContext = createComputeRequestAbortContext(req, res);
  try {
    const configured = await isComputeConfigured();
    if (!configured) return res.status(400).json({ success: false, error: 'Not configured' });

    const output = await ComputeNode.run({
      command: 'echo "=== Connection OK ===" && uname -a && echo "=== GPU Info ===" && (nvidia-smi 2>/dev/null || echo "No GPU detected")',
      skipSync: true,
      signal: abortContext.signal,
      timeoutMs: 60_000,
    });
    res.json({ success: true, output });
  } catch (error) {
    if (!res.destroyed) res.json({ success: false, error: error.message });
  } finally {
    abortContext.dispose();
  }
});

router.post('/sync', async (req, res) => {
  const abortContext = createComputeRequestAbortContext(req, res);
  try {
    const { direction = 'up', cwd, files } = req.body;
    if (!cwd) return res.status(400).json({ error: 'Working directory (cwd) is required' });
    const output = await ComputeNode.sync({
      direction,
      cwd,
      files: files || [],
      signal: abortContext.signal,
    });
    res.json({ success: true, output });
  } catch (error) {
    if (!res.destroyed) res.status(500).json({ success: false, error: error.message });
  } finally {
    abortContext.dispose();
  }
});

router.post('/run', async (req, res) => {
  const abortContext = createComputeRequestAbortContext(req, res);
  try {
    const { command, cwd, skipSync = false } = req.body;
    if (!command?.trim()) return res.status(400).json({ error: 'Command is required' });
    const output = await ComputeNode.run({
      command: command.trim(),
      cwd: cwd || undefined,
      skipSync,
      signal: abortContext.signal,
    });
    res.json({ success: true, output });
  } catch (error) {
    if (!res.destroyed) res.status(500).json({ success: false, error: error.message });
  } finally {
    abortContext.dispose();
  }
});

router.get('/status', async (req, res) => {
  try {
    const node = await getActiveNode();
    const configured = !!(node && node.host && node.user && (node.keyPath || node.password));
    res.json({
      configured,
      host: node?.host || '',
      user: node?.user || '',
      workDir: node?.workDir || '~',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

export default router;
