/* eslint-disable class-methods-use-this */
// const debug = require('debug')('homebridge-sos');
const fs = require('fs');
const storageHandler = require('node-persist');
const express = require('express');
const request = require('request').defaults({ encoding: null });
const _http = require('http');
const _https = require('https');
const { v4: uuidv4 } = require('uuid');

const app = express();

function debug(msg) {
  console.log(msg);
}

let Service;
let Characteristic;
let CustomServer;
let MotionService;
let MotionState = false;
let storage;
const Characteristics = {};

class HBSOS {
  constructor(log, config) {
    this.log = log;
    this.name = config.name;

    this.dataDir = config.dataDir || './data';

    this.httpPort = config.httpPort || 8055;

    this.tlsPort = config.tlsPort || 9045;
    this.tlsCert = config.tlsCert;
    this.tlsKey = config.tlsKey;

    this.contactCall = config.contactCall;

    this.http = _http.createServer(app).listen(this.httpPort);
    debug(`Listening on ${this.httpPort}`);

    this.https = undefined;
    if (this.tlsCert && this.tlsKey && this.tlsCert.length > 2 && this.tlsKey.length > 2) {
      debug('TLS Support Enabled!');
      this.https = _https.createServer({
        key: fs.readFileSync(this.tlsKey),
        cert: fs.readFileSync(this.tlsCert),
      }, app).listen(this.tlsPort);
      debug(`Listening on ${this.tlsPort}`);
    }

    storage = storageHandler.create({
      dir: this.dataDir,
      stringify: JSON.stringify,
      parse: JSON.parse,
      encoding: 'utf8',
      logging: false,
      ttl: false,
      expiredInterval: 2 * 60 * 1000, // every 2 minutes the process will clean-up the expired cache
      forgiveParseErrors: true,
    });
    storage.init().then((res) => {
      debug(`Initialized successfully the Local parameters storage @ ${res.dir}`);
      storage.keys()
        .then((keys) => {
          debug('Values in storage:');
          keys.forEach((key) => {
            storage.get(key)
              .then((value) => {
                debug(`"${key}" = "${value}"`);
              })
              // eslint-disable-next-line no-unused-vars
              .catch((err) => {
                debug(`Could not read ${key}'s value!`);
              });
          });
        });
    });

    MotionService = new Service.MotionSensor(this.name);
    MotionService
      .getCharacteristic(Characteristic.MotionDetected)
      .on('get', this.getMotion.bind(this));


    if (this.contactCall) {
      this.contactCall.forEach((contact) => {
        const state = CustomServer.getItem(contact);
        this.service = new Service.ContactSensor(state.key);
        this.service
          .getCharacteristic(Characteristic.ContactSensorState)
          .on('get', () => (state.value === 'Yes' || state.value === '1'));
      });
    }

    this.getAllItems.then((results) => {
      debug(results);
      if (results.length > 0) {
        results.forEach((object) => {
          if (object.uuid !== undefined) {
            const char = new Characteristic(object.key, object.uuid);

            char.setProps({
              format: Characteristic.Formats.STRING,
              perms: [
                Characteristic.Perms.READ,
                Characteristic.Perms.NOTIFY,
              ],
            });
            char.value = object.value;

            Characteristics[object.uuid] = char;

            MotionService
              .addCharacteristic(Characteristics[object.uuid])
              .on('get', callback => callback(null, this.getItem(object.key)));
          }
        });
      }
    });

    setTimeout(this.refreshValues, 5000);
    setInterval(this.refreshValues, 60000);
    this.startServer();
  }

  getMotion(callback) {
    callback(null, MotionState);
  }

  getServices() {
    return [MotionService];
  }

  refreshValues() {
    CustomServer.getAllItems.then((results) => {
      if (results.length > 0) {
        results.forEach((object) => {
          if (object.uuid !== undefined) {
            Characteristics[object.uuid]
              .updateValue(this.getItem(object.key));
          }
        });
      }
    });
  }

  getAllItems() {
    return new Promise((resolve) => {
      storage.keys()
        // eslint-disable-next-line consistent-return
        .then((keys) => {
          if (keys.length === 0) {
            resolve([]);
          }
          const results = [];
          keys.forEach((key, index) => {
            storage.get(key)
              // eslint-disable-next-line consistent-return
              .then((value) => {
                results.push({
                  key,
                  value: value.item,
                  uuid: value.uuid,
                });
                if (index === keys.length - 1) {
                  resolve(results);
                }
              })
              .catch((err) => {
                debug(err.message);
                resolve([]);
              });
          });
        })
        .catch((err) => {
          debug(err.message);
          resolve([]);
        });
    });
  }

  getItem(key) {
    storage.get(key)
      // eslint-disable-next-line consistent-return
      .then(value => value.item)
      .catch((err) => {
        debug(err.message);
        return 'NOVAL';
      });
  }

  startServer() {
    app.use(express.json({ limit: '5mb' }));
    app.use(express.urlencoded({ extended: true, limit: '5mb' }));
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*'); // update to match the domain you will make the request from
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-WSS-Key, X-API-Key, X-User-Agent, User-Agent');
      next();
    });

    app.get('/', (req, res) => {
      res.status(200).send('<b>Lizumi storage API v1.2</b>');
    });
    app.get('/get', (req, res) => {
      if (req.query.item !== undefined && req.query.item !== '') {
        storage.getItem(req.query.item)
          .then((results) => {
            if (results && results !== 'undefined' && results !== '') {
              res.status(200).send(results);
              debug(`Request: "${req.query.item}" = "${results}"`);
            } else {
              res.status(404).send('NOT_FOUND');
              debug(`Request Error: "${req.query.item}" does not exist yet`);
            }
          })
          .catch((err) => {
            res.status(500).send();
            debug(`Request Error: "${req.query.item}"`);
            debug(err);
          });
      } else {
        res.status(500).send('INVALID_REQUEST');
        debug('Request Error missing query!');
      }
    });
    app.get('/all', (req, res) => {
      storage.keys()
        .then((keys) => {
          if (keys.length === 0) {
            res.status(404).send('EMPTY');
            debug('Request Error: There are no items in storage');
          } else {
            const results = [];
            keys.forEach((key, index) => {
              storage.get(key)
                .then((value) => {
                  results.push({ key, value });
                  if (index === keys.length - 1) {
                    res.status(200).send(results);
                    debug(results);
                  }
                })
                // eslint-disable-next-line no-unused-vars
                .catch((err) => {
                  debug(`Could not read ${key}'s value!`);
                });
            });
          }
        })
        .catch((err) => {
          res.status(500).send();
          debug('Request Error:');
          debug(err);
        });
    });
    app.get('/set', async (req, res) => {
      if (req.query.item !== undefined && req.query.value !== undefined && req.query.item !== '' && req.query.value !== '') {
        function writeItem(uuid) {
          storage.setItem(req.query.item, {
            item: req.query.value,
            uuid,
          })
            .then((results) => {
              console.log(results);
              if (results && results.content.value.item === req.query.value) {
                res.status(200).send('OK');
                Characteristics[uuid].setValue(results.content.value.item);
                MotionService.getCharacteristic(Characteristic.MotionDetected).updateValue(true);
                setTimeout(() => { MotionService.getCharacteristic(Characteristic.MotionDetected).updateValue(false); }, 500);
                debug(`Save: "${results.content.key}" = "${results.content.value}"`);
              } else {
                res.status(500).send('SAVE_FAILED');
                debug(`Save Error: "${req.query.item}" did not save correctly`);
              }
            })
            .catch((err) => {
              res.status(500).send();
              debug(`Save Error: "${req.query.item}" = "${req.query.value}"`);
              debug(err);
            });
        }

        storage.getItem(req.query.item)
          .then((originalItem) => {
            if (originalItem !== undefined && originalItem !== 'undefined' && originalItem !== '' && originalItem.uuid !== undefined) {
              writeItem(originalItem.uuid);
            } else {
              writeItem(uuidv4());
            }
          });
      } else {
        res.status(500).send('INVALID_REQUEST');
        debug('Save Error missing query or value!');
      }
    });
    app.get('/del', (req, res) => {
      if (req.query.item !== undefined && req.query.item !== '') {
        storage.removeItem(req.query.item)
          .then((results) => {
            if (results && results.removed) {
              res.status(200).send('OK');
              debug(results);
            } else if (results && results.existed === false) {
              res.status(200).send('OK');
              debug(results);
            } else {
              res.status(500).send('DELETE_FAILED');
              debug(`Delete Error: "${req.query.item}" was not removed`);
            }
          })
          .catch((err) => {
            res.status(500).send();
            debug(`Delete Error: "${req.query.item}" = "${req.query.value}"`);
            debug(err);
          });
      } else {
        res.status(500).send('INVALID_REQUEST');
        debug('Delete Error missing query!');
      }
    });
  }
}

module.exports = (homebridge) => {
  Service = homebridge.hap.Service; // eslint-disable-line
  Characteristic = homebridge.hap.Characteristic; // eslint-disable-line

  homebridge.registerAccessory('ACRSOS', HBSOS);
};
