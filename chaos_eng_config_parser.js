const fs = require("fs");
const { map, share, concatMap, delay, bufferTime, bufferCount, filter } = require("rxjs/operators");
const { of, partition, merge } = require("rxjs");
const { Observable } = require("rxjs");

// See https://stackoverflow.com/questions/1527803/generating-random-whole-numbers-in-javascript-in-a-specific-range
const randomIntInRange = (min, max) => {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * 
 * @param {String} configFilePath The file path to the config file to parse
 * @returns a Map in which the keys are the topics in the config file and the values are the array of operators to apply
 */
const parseConfig = (configFilePath) => {
    const operatorsMapPerTopic = new Map();

    const config_obj = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));

    // TODO: If relevant, parse the operators here into custom objects/classes that would simplify applying the operators in `applyOperators`
    for (const topic_obj of config_obj) {
        // Storing the full topic_obj instead of just topic_obj.operators due to startAfter and endAfter
        operatorsMapPerTopic.set(topic_obj.topic, topic_obj);
    }

    return operatorsMapPerTopic;
};

/**
 * Apply the respective operators specified in the config to the given observable
 * @param {Observable} observable Observable to apply operations to
 * @param {Array} operator_list List of operators to apply, objects that follow the specification markdown file.
 * @returns {Observable} The observable with the operators applied
 */
const doApplyOperators = (observable, operator_list) => {
    let modified_observable = observable;

    for (const operator of operator_list) {
        switch(operator.type) {
            case "map":
                if (!operator?.func) {
                    console.error("Error: No map function given for map operator");
                    break;
                }
                // See https://stackoverflow.com/a/45676430/5437511
                const mapper_function = new Function('return ' + operator.func)()

                modified_observable = modified_observable.pipe(map(mapper_function));
                break;
            case "randomDelay":
                if (!operator?.max) {
                    console.error("Error: No maximum value given for randomDelay operator");
                    break;
                }
                const min = operator?.min || 0;
                const max = operator.max;

                // See https://stackoverflow.com/questions/35060681/rxjs-how-can-i-generate-a-stream-of-numbers-at-random-intervals-within-a-speci
                modified_observable = modified_observable.pipe(
                    concatMap(pkt => of(pkt).pipe(delay(randomIntInRange(min, max))))
                );

                break;
            case "buffer":
                if (!operator?.time && !operator?.maxSize) {
                    console.error("Error: either 'time' or 'maxSize' arguments must be provided to buffer operator");
                    break;
                }

                if (operator?.time && operator?.maxSize) {
                    modified_observable = modified_observable.pipe(bufferTime(operator.time, operator.time, operator.maxSize));
                } else if (operator?.time) {
                    modified_observable = modified_observable.pipe(bufferTime(operator.time));
                } else {
                    modified_observable = modified_observable.pipe(bufferCount(operator.maxSize));
                }

                break;

            case "randomDrop":
                if (!operator?.chance) {
                    console.error("Error: No drop chance given for randomDrop operator");
                    break;
                }

                const chance = operator.chance;

                if (chance > 1 || chance < 0) {
                    console.error("Error: Packet drop chance must be in [0,1] for randomDrop operator");
                    break;
                }

                modified_observable = modified_observable.pipe(filter((_) => Math.random() > chance));

                break;
            default:
                console.warn(`Unexpected operator type of ${operator.type}!`)
                break;
        }
    }

    // Ensure that the observale is "multicasted" to prevent executing the operators for each subscription
    // See: https://stackoverflow.com/questions/50353514/observable-executing-once-with-multiple-subscriber
    // (supposedly since we are using subjects this shouldn't be necessary but it appears that this is a cold subject....)
    modified_observable = modified_observable.pipe(share())

    return modified_observable;
};

const applyOperators = (observable, topic_config) => {
    if (topic_config.startAfter || topic_config.stopAfter) {
        // The operators will only be applied while inside the configured message index range
        // Returning true in the partition function will send to the first observable, false will forward to the second one
        const [forwardToOperators, shortCircuitWithoutOperators] = partition(observable, (_val, idx) =>
            (topic_config.startAfter||-Infinity) <= idx && idx <= (topic_config.stopAfter || Infinity));
        const operatedObservable = doApplyOperators(forwardToOperators, topic_config.operators);

        return merge(shortCircuitWithoutOperators, operatedObservable);
    } else {
        return doApplyOperators(observable, topic_config.operators);
    }
}

module.exports = {
    parseConfig,
    applyOperators
}
