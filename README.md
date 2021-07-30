<!-- markdownlint-disable MD013 MD024 -->

# Instrumentable-Aedes

Barebone MQTT server that can run on any stream servers, with added instrumentable features that can be used for fault-injection porpuses.

**Disclaimer**: This is part of a research project at the [Faculdade de Engenharia da Universidade do Porto](https://sigarra.up.pt/feup/en/web_page.inicial) and its usage in other scopes is not recommended.

## API

- [Aedes object](./docs/Aedes.md)
- [Client object](./docs/Client.md)

## Specification for the JSON config for Fault-Injection operators

### Base syntax

The JSON should be an array of objects.

Each object must contain a `topic` attribute with a value of a string, as well as a `operators` attribute, whose type is an array.

Example:

```json
[
  {
    "topic": "/test/123",
    "operators": [
      // operator 1
      // operator 2
    ]
  },
  {
    "topic": "/test2/456",
    "operators": [
      // operator 1
      // operator 2
    ]
  }
]
```

**Important note:** Topics with wildcard characters (`+` or `#`) are not supported yet.

### Starting and stopping chaos for a topic

It is possible to specify the range between which a certain topic's operators should be applied.

To do so, it is possible to specify the `startAfter` and/or `stopAfter` attributes in a topic object.

Example:

```json
[
  {
    "topic": "test/starting_after_5_messages",
    "startAfter": 5,
    "operators": [
      // Operator list
    ]
  },
  {
    "topic": "test/applying_operators_between_message_1_and_100",
    "startAfter": 1,
    "endAfter": 100,
    "operators": [
      // ...
    ]
  }
]
```

The values are considered message indexes. The first message will have index 0. The pipeline will stop being applied at the `stopAfter` index, and not at `startAfter+stopAfter`. The interval is inclusive (i.e. the pipeline's operators will be applied to messages with index in `[startAfter, stopAfter]`).

### Operators

Each operator should be defined as an object with a mandatory attribute `type`, its value being a `String`. This defines the type of the operator.

The operators are applied sequentially, in the order that they are defined in the JSON file.

In order to provide arguments to an operator, check which keys they use. For example, the `Map` operator uses `func` as a key, while the `RandomDelay` operator uses `min` and `max`.

If an operator requires a function to be defined, it should be defined in `function(args)` syntax. Arrow functions will not work for now.

Example operator definition:

```json
[
  {
    "topic": "/test/add1",
    "operators": [
      { "type": "map", "func": "function (x) { return x + 1}" },
      { "type": "randomDelay", "min": 30, "max": 360 }
    ]
  }
]
```

#### Map

**Arguments**

- `type` = `map`
- `func` : Function defined as a `String`

**Description**

As per [`rxjs` docs](https://rxjs.dev/api/operators/map), this operator should be provided with a function (as a string) as the `func` attribute, which will receive the value of the current event/message.

The value returned by the function will be used in the following steps of the pipeline.

#### RandomDelay

**Arguments**

- `type` = `randomDelay`
- `min` : Number (Integer), optional (default 0)
- `max` : Number (Integer)

This operator adds a random delay to the messages in the pipeline. Messages are delayed by a random integer value in`[min, max]`.

The `min` and `max` values are interpreted as milisseconds. `Math.random()` is used for randomness.

#### Buffer

**Arguments**

- `type` = `buffer`
- `time` : Number (Integer)
- `maxSize` : Number (Integer)

This operator buffers up to `maxSize` messages or waits until `time` milisseconds elapse (whichever happens first) and releases the captured messages all at once.

Either `time` or `maxSize` must be provided. Both can also be provided.

**Note:** If a `map` operator (or any operator that accesses values) is used after this, the packets will be in an `Array`.

#### RandomDrop

**Arguments**

- `type` = `randomDrop`
- `chance` : Number (Decimal/Float)

This operator randomly drops some messsages in the pipeline. Messages have a chance of `chance` to be dropped (`chance` must be between 0 and 1, in which `chance = 1` means that all messages are dropped).

`Math.random()` is used for randomness.

## Acknowledgments

The original AEDES broker is available [here](https://github.com/moscajs/aedes). 

Modifications for adding fault-injection capabilites were done by [Miguel Duarte](https://miguelpduarte.me/) on the development of their master's thesis entitled "MQTT Fault-Injection for Self-Healing IoT Systems" at the [Faculdade de Engenharia da Universidade do Porto](https://sigarra.up.pt/feup/en/web_page.inicial).