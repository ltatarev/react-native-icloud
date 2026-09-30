// The package is iOS-only. Disable Android autolinking so the app's Android
// build does not compile it.
module.exports = {
  dependency: {
    platforms: {
      android: null,
    },
  },
};
