import ComputePanel from '../ComputePanel';
import { useTaskMaster } from '../../contexts/TaskMasterContext';
import ProFeatureGate from '../entitlements/ProFeatureGate';
import { CAPABILITIES } from '../../hooks/useEntitlements';

export default function ComputeSettingsContent() {
  const { currentProject } = useTaskMaster();

  return (
    <ProFeatureGate capability={CAPABILITIES.computeResources} feature="computeResources" compact>
      <div className="min-h-[420px] overflow-hidden rounded-2xl border border-border bg-background">
        <ComputePanel selectedProject={currentProject || null} selectionManagedExternally />
      </div>
    </ProFeatureGate>
  );
}
