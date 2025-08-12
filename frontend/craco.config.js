const path = require('path');

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // Fix deprecation warnings for webpack dev server
      if (webpackConfig.devServer) {
        // Remove deprecated onBeforeSetupMiddleware and onAfterSetupMiddleware
        delete webpackConfig.devServer.onBeforeSetupMiddleware;
        delete webpackConfig.devServer.onAfterSetupMiddleware;
        
        // Use the new setupMiddlewares option instead
        webpackConfig.devServer.setupMiddlewares = (middlewares, devServer) => {
          // Custom middleware can be added here if needed
          return middlewares;
        };
      }

      return webpackConfig;
    },
  },
  
  // Disable the util._extend deprecation warning
  jest: {
    configure: (jestConfig) => {
      // Suppress Node.js deprecation warnings during tests
      process.env.NODE_NO_WARNINGS = '1';
      return jestConfig;
    },
  },
};