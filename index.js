// const debug = require('debug')('homebridge-sos');
const ACRSOS = require('./sos-server');

function debug(msg) {
  console.log(msg);
}

let Service;
let Characteristic;
let CustomServer;
let MotionService
const Characteristics = {};

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

    MotionService = new Service.MotionSensor(this.name);

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

    CustomServer.getAllItems.then((results) => {
      debug(results);
      if (results.length > 0) {
        results.forEach((object) => {
          if (object.uuid !== undefined) {
            const char = new Characteristic(object.key, object.uuid);

            char.setProps({
              format: Characteristic.Formats.STRING,
              perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
            });
            char.value = object.value;

            Characteristics[object.uuid] = char;

            MotionService
              .addCharacteristic(Characteristics[object.uuid])
              .on('get', callback => callback(null, CustomServer.getItem(object.key)));
          }
        });
      }
    });

    setTimeout(this.refreshValues, 5000);
    setInterval(this.refreshValues, 60000);
  }

  getServices() {
    return [MotionService];
  }
  refreshValues() {
    CustomServer.getAllItems.then((results) => {
      debug(results);
      if (results.length > 0) {
        results.forEach((object) => {
          if (object.uuid !== undefined) {
            MotionService
              .setCharacteristic(Characteristics[object.uuid], CustomServer.getItem(object.key))
          }
        });
      }
    });
  }
}

module.exports = (homebridge) => {
  Service = homebridge.hap.Service; // eslint-disable-line
  Characteristic = homebridge.hap.Characteristic; // eslint-disable-line

  homebridge.registerAccessory('ACRSOS', HBSOS);
};
