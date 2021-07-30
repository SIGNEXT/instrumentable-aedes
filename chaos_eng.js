const mqtt = require('mqtt');
const { Subject } = require('rxjs');

const { parseConfig, applyOperators } = require("./chaos_eng_config_parser");

const TOPIC_BASE = "cfqomeaf"
const LOGGING_TOPIC = TOPIC_BASE + "/log"
const CONFIG_TOPIC = TOPIC_BASE + "/config"

/**
 * Helper class to simplify storing Topic registrations in the `topicRegistry` Map
 */
class TopicRegistration {
    constructor(subject, mqemitterListener, originalSubject) {
        this.subject = subject;
        this.mqemitterListener = mqemitterListener;
        // Set of client registration functions in order to track the number of subscriptions so that topic subjects can be cleaned up when no longer necessary
        this.clientFuncRegistry = new Set();
        // Storing the original subject to always be able to .complete() regardless if this.subject is an Observable or Subject
        this.originalSubject = originalSubject;
    }
}


class ChaosEng {
    #broker;
    #active = false;
    #client;
    #config = new Map();

    get active() {
        return this.#active;
    }

    setBroker = (broker) => {
        this.#broker = broker;
    }

    setConfig = (configFilePath) => {
        this.#config = parseConfig(configFilePath);
    }

    connect = (host, port) => {
        this.#client = mqtt.connect(`tcp://${host}:${port}`, {clientId: "ChaosEngController"})

        this.#client.on("connect", () => {
            if (this.#broker) {
                this.#active = true
            }

            this.#log("ChaosEng toolkit connected to MQTT broker")

            this.#createSubscriptions();
        })

        this.#client.on("message", this.#handleMessage)
    }

    #createSubscriptions = () => {
        this.#client.subscribe(CONFIG_TOPIC, (err) => {
            if (err) {
                this.#log(`Failed to subscribe to config topic: ${err}`)
            } else {
                this.#log("Subscribed to config topic")
            }
        })
    }

    #handleMessage = (topic, message) => {
        if (topic === CONFIG_TOPIC) {
            const msgData = message.toString('utf8')

            if (msgData === 'get_clients') {
                this.#log(Object.keys(this.#broker.clients).toString())
            }
        }
    }

    #log = (msg) => {
        this.#client.publish(LOGGING_TOPIC, msg)
    }

    emitPacket = (packet, defaultBehaviour) => {
        if (packet.cmd === 'publish' && packet.topic === '/teste') {
            this.#log('\x1b[01;31mHACKY_DBG:\x1b[0m Delaying the sending by 2 seconds!')
            setTimeout(defaultBehaviour, 2000)
            return
        } else {
            defaultBehaviour();
        }
    }

    /**
     * Maps a topic to a `TopicRegistration`. See `#getTopicSubject`
     */
    #topicRegistry = new Map();

    /**
     * Associates the listener function we intercepted with its subscription of the respective Rxjs subject
     * Used to cancel subscription from that subject, cleaning up resources
     */
    #subjectSubscriptionRegistry = new Map();

    interceptSubscribe = (topic, originalFunc, done, client) => {
        if (topic.includes("#") || topic.includes("+")) {
            console.warn("Subscription to topic with wildcards not yet supported");
            this.#log(`Warning: Attempted to intercept sub to topic with wildcards (${topic}), which is not supported`)
            // Topic with wildcards not yet supported, doing default behaviour

            this.#broker.mq.on(topic, originalFunc, done);
            return
        }

        if (!client) {
            this.#log("Warning: Got a subscription request without associated client")
        }

        console.log("--->> intercepted for topic:", topic)

        // TODO: Possibility for filtering/operating with client when subscribing

        // Ensuring that there is only one subject per topic
        const subject = this.#getTopicSubject(topic);
        
        const subscription = subject.subscribe((packet) => {
            // Packet may be an array of packets (if `buffer` operator is used)
            if (Array.isArray(packet)) {
                if (!packet.length) {
                    // Empty array, ignore
                    return;
                }

                console.log(`--->> Got ${packet.length} packets`);

                for (const p of packet) {
                    // May need setImmediate here to not delay the rest of the code?
                    originalFunc(p, () => {});
                }
                return;
            }

            // We can use the client parameter here to filter packets if desired (by not calling originalFunc)
            console.log("--->> Got sub event", packet);
            // callback is a no-op function, since it would simply be the "done" callback from mqemitter, that is already being called in the rxjs callback
            originalFunc(packet, () => {});
        });

        this.#subjectSubscriptionRegistry.set(originalFunc, subscription);
        this.#topicRegistry.get(topic).clientFuncRegistry.add(originalFunc);

        // Tell the subscription process we are done
        done();
    }

    /**
     * Gets the subject for a topic, preventing several from being created for the same topic (to prevent repeatedly running operators)
     * If a subject has not been created yet, creates it and stores it.
     * @param {String} topic the topic to get the subject for
     */
    #getTopicSubject = (topic) => {
        if (this.#topicRegistry.has(topic)) {
            // Already have topic subject created, return it
            return this.#topicRegistry.get(topic).subject;
        }

        // Subject has not yet been created, so create it and add the respective operators
        console.log("--->> Creating subject for topic:", topic)
        const subject = new Subject();
        const operatedSubject = this.#addOperators(subject, topic);

        const mqemitterListener = (packet, cb) => {
            subject.next(packet);
            // Assuming the multicast runs synchronously, we can tell mqemitter that we are done
            cb();
        }

        const topicRegistry = new TopicRegistration(operatedSubject, mqemitterListener, subject);
        this.#topicRegistry.set(topic, topicRegistry);

        // Ask mqemitter for packets on this topic
        this.#broker.mq.on(topic, mqemitterListener);

        return topicRegistry.subject;
    }

    #addOperators = (subject, topic) => {
        const topic_config = this.#config.get(topic);

        if (topic_config) {
            return applyOperators(subject, topic_config);
        } else {
            this.#log(`Warning: Registered subject for topic "${topic}" that is not present in the config file.`)
            return subject;
        }
    }

    interceptUnsubscribe = (topic, func, done) => {
        if (topic.includes("#") || topic.includes("+")) {
            // Topic with wildcards not yet supported, doing default behaviour
            this.#broker.mq.removeListener(topic, func, done)
            return
        }

        const { subject, mqemitterListener, clientFuncRegistry, originalSubject } = this.#topicRegistry.get(topic);

        const subscription = this.#subjectSubscriptionRegistry.get(func);
        subscription.unsubscribe();

        // Unregister this client from the subscription set to track how many are listening
        clientFuncRegistry.delete(func);

        // If no one else is listening, clean up
        if (clientFuncRegistry.size < 1) {
            console.log(`__- No one else is listening to ${topic}, freeing resources`)
            this.#broker.mq.removeListener(topic, mqemitterListener);
            originalSubject.complete();
            this.#topicRegistry.delete(topic);
        }

        done();
    }
}

module.exports = new ChaosEng()
