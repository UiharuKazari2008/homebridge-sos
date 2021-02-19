const debug = require('debug')('homebridge-sos');
const ACRSOS = require('./sos-server');

let Service;
let Characteristic;
let CustomServer;

class HBSOS {
  constructor(log, config) {
    this.log = log;
    this.name = config.name;

    this.dataDir = config.dataDir || './data';

    this.httpport = config.httpPort || 8055;

    this.tlsport = config.tlsPort || 9045;
    this.tlscert = config.tlsCert;
    this.tlskey = config.tlsKey;

    this.contactCall = config.contactCall;

    let TLSOptions;

    if (this.tlscert && this.tlskey && this.tlscert.length > 2 && this.tlskey.length > 2) {
      debug('TLS Support Enabled!');
      TLSOptions = {
        httpsPort: this.tlsport,
        tlsCert: this.tlscert,
        tlsKey: this.tlskey,
      };
    }

    this.motionService = new Service.MotionSensor(this.name);

    CustomServer = ACRSOS({
      httpPort: this.httpport,
      dataDir: this.dataDir,
    }, TLSOptions);

    if (this.contactCall) {
      this.contactCall.forEach((contact) => {
        const state = CustomServer.getItem(contact);
        this.service = new Service.ContactSensor(state.key);
        this.service
          .getCharacteristic(Characteristic.ContactSensorState)
          .on('get', () => (state.value === 'Yes' || state.value === '1'));
      });
    }

    this.addCharacteristics();
    this.refreshValues();
  }

  refreshValues() {
    CustomServer.getAllItems.then((results) => {
      debug(results);
      if (results.length > 0) {
        results.forEach((object) => {
          this.motionService
            .getCharacteristic(() => {
              const char = new Characteristic(object.key, object.uuid);

              char.setProps({
                format: Characteristic.Formats.UINT8,
                maxValue: 12,
                minValue: 1,
                minStep: 1,
                perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
              });
              char.value = object.value;

              return char;
            })
            .updateValue(CustomServer.getItem(object.key));
        });
      }
    });
    // Set timeout
    setTimeout(
      this.refreshValues.bind(this),
      60000,
    );
  }

  async addCharacteristics() {
    CustomServer.getAllItems.then((results) => {
      debug(results);
      if (results.length > 0) {
        results.forEach((object) => {
          this.motionService
            .addCharacteristic(() => {
              const char = new Characteristic(object.key, object.uuid);

              char.setProps({
                format: Characteristic.Formats.UINT8,
                maxValue: 12,
                minValue: 1,
                minStep: 1,
                perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
              });
              char.value = object.value;

              return char;
            })
            .on('get', callback => callback(null, CustomServer.getItem(object.key)));
        });
      }
    });
  }
}

module.exports = (homebridge) => {
  Service = homebridge.hap.Service; // eslint-disable-line
  Characteristic = homebridge.hap.Characteristic; // eslint-disable-line

  homebridge.registerAccessory('homebridge-sos', 'ACRSOS', HBSOS);
};
// eslint-disable-next-line func-names
HBSOS.prototype.getServices = function() {
  return [this.motionService];
};
