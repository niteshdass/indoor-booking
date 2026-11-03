// Slot times must come from the venue timezone, never the device's: run every test as a UTC device.
module.exports = async () => {
  process.env.TZ = 'UTC';
};
