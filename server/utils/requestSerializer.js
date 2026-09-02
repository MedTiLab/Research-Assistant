// Serializes Express requests that share a key, so a read-modify-write handler
// cannot interleave with itself. The lock is held until the response completes,
// which is the point at which the handler's effects are observable to the next
// request.
export function createRequestSerializer(resolveKey) {
  const locks = new Map();

  return function serializeRequest(req, res, next) {
    const key = String(resolveKey(req));
    const previous = locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    locks.set(key, current);

    const finish = () => {
      release();
      if (locks.get(key) === current) {
        locks.delete(key);
      }
    };
    // 'close' covers an aborted request that never produced a response.
    res.once('finish', finish);
    res.once('close', finish);

    previous.catch(() => {}).then(() => next());
  };
}
