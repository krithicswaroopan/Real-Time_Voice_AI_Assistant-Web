// Script to suppress Node.js deprecation warnings
// This can be used as an alternative to CRACO

const originalEmit = process.emit;

process.emit = function (name, data, ...args) {
  // Suppress specific deprecation warnings
  if (
    name === 'warning' &&
    typeof data === 'object' &&
    data.name === 'DeprecationWarning' &&
    (
      data.message.includes('onAfterSetupMiddleware') ||
      data.message.includes('onBeforeSetupMiddleware') ||
      data.message.includes('util._extend')
    )
  ) {
    return false;
  }

  return originalEmit.call(this, name, data, ...args);
};

console.log('✅ Deprecation warnings suppressed');