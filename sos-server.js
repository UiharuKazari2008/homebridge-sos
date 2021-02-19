/* eslint-disable max-len */
//const debug = require('debug')('homebridge-sos');
const fs = require('fs');
const storageHandler = require('node-persist');
const express = require('express');
const request = require('request').defaults({ encoding: null });
const _http = require('http');
const _https = require('https');
const { v4: uuidv4 } = require('uuid');

function debug(msg) {
  console.log(msg);
}

const app = express();

const server = (Options, service, TLSOpts) => {
  let https;

  const http = _http.createServer(app).listen(Options.httpPort);
  debug(`Listening on ${Options.httpPort}`);
  if (TLSOpts && TLSOpts.httpsPort) {
    https = _https.createServer({
      key: fs.readFileSync(TLSOpts.tlsKey),
      cert: fs.readFileSync(TLSOpts.tlsCert),
    }, app).listen(TLSOpts.httpsPort);
    debug(`Listening on ${TLSOpts.httpsPort}`);
  }

  const storage = storageHandler.create({
    dir: Options.dataDir,
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
            .catch((err) => {
              debug(`Could not read ${key}'s value!`);
            });
        });
      });
  });

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // update to match the domain you will make the request from
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-WSS-Key, X-API-Key, X-User-Agent, User-Agent');
    next();
  });
  app.get('/', (req, res) => {
    res.status(200).send('<b>Lizumi Storage API v1.2</b>');
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
              service[uuid].setValue(results.content.value.item);
              service.MotionDetected.setValue(true);
              setTimeout(() => { service.MotionDetected.setValue(false); }, 500);
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
            console.log('Has UUID');
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

  /* app.get('/cet', (req, res) => {
    if (req.query.item !== undefined && req.query.value !== undefined && req.query.item !== '' && req.query.value !== '') {
      storage.setItem(req.query.item, req.query.value)
        .then((results) => {
          if (results && results.content.value === req.query.value) {
            res.status(200).send('OK');
            debug(`Save: "${results.content.key}" = "${results.content.value}"`);
            if (req.query.opt !== undefined && req.query.opt !== '' && config['call-urls'][parseInt(req.query.opt.toString())] !== undefined && config['call-urls'][parseInt(req.query.opt.toString())] !== '') {
              request({
                url: config['call-urls'][parseInt(req.query.opt.toString())].toString(),
                method: 'GET',
                timeout: 5000,
              }, (error, response, body) => {
                if (!error && response.statusCode === 200) {
                  debug(`Call: "${config['call-urls'][parseInt(req.query.opt.toString())].toString()}" = "${body}"`);
                } else {
                  debug(`Failed Call: "${config['call-urls'][parseInt(req.query.opt.toString())].toString()}" = "${body}"`);
                }
              });
            } else {
              debug('Failed Call: Unable to process the requested option');
            }
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
    } else {
      res.status(500).send('INVALID_REQUEST');
      debug('Save Error missing query or value!');
    }
  }); */

  const getAllItems = new Promise((resolve) => {
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
                uuid: value.uuid
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

  const getItem = key => new Promise((resolve) => {
    storage.get(key)
      // eslint-disable-next-line consistent-return
      .then(value => resolve(value.item))
      .catch((err) => {
        debug(err.message);
        resolve('NOVAL');
      });
  });

  return {
    getAllItems,
    getItem,
  };
};

module.exports = server;
