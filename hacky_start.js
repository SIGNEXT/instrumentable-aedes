'use strict'

// Copied from aedes-cli

const net = require('net')
const aedes = require('./aedes')
const aedesPers = require('aedes-persistence')
const mqemitter = require('mqemitter')

const chaosEng = require("./chaos_eng")

const defaultCfgs = {
  // SERVERS
  protos: ['tcp'],
  host: '127.0.0.1',
  port: 1883,
  wsPort: 3000,
  wssPort: 4000,
  tlsPort: 8883,
  key: null,
  cert: null,
  rejectUnauthorized: true,
  // AUTHORIZER
  credentials: null,
  // AEDES
  brokerId: 'aedes-cli',
  concurrency: 100,
  queueLimit: 42,
  maxClientsIdLength: 23,
  heartbeatInterval: 60000,
  connectTimeout: 30000,
  stats: true,
  statsInterval: 5000,
  // PERSISTENCES
  persistence: null,
  mq: null,
  // LOGGER
  verbose: false,
  veryVerbose: false,
  noPretty: false
}

/**
 * Servers factory
 *
 * @api private
 * @param {String} protocol the protocol
 * @param {Object} options options for secure protocols
 * @param {Aedes.handle} handle Aedes handle
 * @param {Function} done callback
 */
async function createServer (protocol, host, port, options, handle) {
  return new Promise((resolve, reject) => {
    let server = null
    // if (protocol === 'tls') {
    //   server = tls.createServer(options, handle)
    // } else if (protocol === 'ws' || protocol === 'wss') {
    //   server = protocol === 'ws' ? http.createServer() : https.createServer(options)
    //   startWebsocket(server, handle)
    // } else if (protocol === 'tcp') {
    if (protocol === 'tcp') {
      server = net.createServer(handle)
    } else {
      reject(Error('Invalid protocol ' + protocol))
    }

    if (server) {
      server._protocol = protocol
      server.listen(port, host, (err) => {
        if (err) reject(err)
        else resolve(server)

        console.log('%s server listening on port %s:%d', protocol.toUpperCase(), host, port)
        chaosEng.connect(host, port)
      })
    }
  })
}

const initPersistence = () => ({ persistence: aedesPers(), mq: mqemitter() })

const registerLogging = (broker) => {
  const logger = console
  broker.on('subscribe', function (subscriptions, client) {
    logger.info('Client \x1b[32m%s\x1b[0m SUBSCRIBED to: %s, broker %s', client ? client.id : client, subscriptions.map(s => s.topic).join('\n'), broker.id)
  })

  broker.on('unsubscribe', function (subscriptions, client) {
    logger.info('Client \x1b[32m%s\x1b[0m UNSUBSCRIBED to: %s, broker %s', client ? client.id : client, subscriptions.map(s => s.topic).join('\n'), broker.id)
  })

  // fired when a client connects
  broker.on('client', function (client) {
    logger.info('Client \x1b[33m%s\x1b[0m CONNECTED, broker %s', (client ? client.id : client), broker.id)
  })

  // emitted when the client has received all its offline messages and be initialized
  broker.on('clientReady', function (client) {
    logger.info('Client \x1b[33m%s\x1b[0m READY, broker %s', (client ? client.id : client), broker.id)
  })

  // emitted when an error occurs
  broker.on('clientError', function (client, error) {
    logger.error('Client \x1b[33m%s\x1b[0m ERROR: %s, broker %s', (client ? client.id : client), error.message, broker.id)
  })

  // like clientError but raises only when client is uninitialized
  broker.on('connectionError', function (client, error) {
    logger.error('Client \x1b[33m%s\x1b[0m ERROR: %s, broker %s', (client ? client.id : client), error.message, broker.id)
  })

  // fired when timeout happes in the client keepalive.
  broker.on('keepaliveTimeout', function (client) {
    logger.error('Client \x1b[33m%s\x1b[0m KEEPALIVE timeout, broker %s', (client ? client.id : client), broker.id)
  })

  // QoS 1 or 2 acknowledgement when the packet successfully delivered to the client
  broker.on('ack', function (packet, client) {
    logger.debug('ACK of %s received from client \x1b[33m%s\x1b[0m, broker %s', packet ? packet.topic : packet, (client ? client.id : client), broker.id)
  })

  // when client sends a PINGREQ
  broker.on('ping', function (packet, client) {
    logger.debug('PINGREQ received from client \x1b[33m%s\x1b[0m, broker %s', (client ? client.id : client), broker.id)
  })

  // when server sends a CONNACK to client
  broker.on('connackSent', function (packet, client) {
    logger.debug('CONNACK sent to \x1b[33m%s\x1b[0m, broker %s', (client ? client.id : client), broker.id)
  })

  // fired when a client disconnects
  broker.on('clientDisconnect', function (client) {
    logger.info('Client \x1b[33m%s\x1b[0m DISCONNECTED, broker %s', (client ? client.id : client), broker.id)
  })

  // fired when a message is published
  broker.on('publish', function (packet, client) {
    logger.info('Client \x1b[31m%s\x1b[0m PUBLISH %s on %s, broker %s', (client ? client.id : 'BROKER_' + broker.id), packet.payload.toString(), packet.topic, broker.id)
  })
}

const main = async () => {
  const config = {}

  // 0 is node, 1 is script path, so from 2 onwards is relevant.
  const cmdline_args = process.argv.slice(2);

  // merge any unspecified options into opts from defaults (defopts)
  for (const k in defaultCfgs) {
    if (config[k] === undefined) {
      config[k] = defaultCfgs[k]
    }
  }

  const ports = {
    tcp: config.port,
    ws: config.wsPort,
    tls: config.tlsPort,
    wss: config.wssPort
  }

  const { persistence, mq } = initPersistence()

  const aedesOpts = {
    persistence: persistence,
    mq: mq
  }

  aedesOpts.concurrency = config.concurrency
  aedesOpts.queueLimit = config.queueLimit
  aedesOpts.maxClientsIdLength = config.maxClientsIdLength
  aedesOpts.heartbeatInterval = config.heartbeatInterval
  aedesOpts.connectTimeout = config.connectTimeout
  aedesOpts.id = config.brokerId

  const broker = aedes(aedesOpts)
  chaosEng.setBroker(broker)

  if (cmdline_args.length > 0) {
    const config_file_path = cmdline_args[0];
    console.log(`Starting with config file at: ${config_file_path}`)
    chaosEng.setConfig(config_file_path);
  } else {
    console.warn("Warning: starting without config file.");
  }

  // if (broker.persistence.waitForReady) {
  //     await once(broker.persistence, 'ready')
  // }

  registerLogging(broker)

  // Ignoring authorizer for now

  const serverOpts = {}

  // TODO: Probably de-generalize since we are only using TCP probably
  const servers = []

  for (const p of config.protos) {
    servers.push(await createServer(p, config.host, ports[p], serverOpts, broker.handle))
  }

  // temp hack
  let logger

  return { servers, broker, logger }
}

main()
