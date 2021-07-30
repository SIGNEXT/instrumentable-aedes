aedes.js

emitPacket
-> have access to packet that has cmd, topic and payload. Can prevent or delay emitting to the mq here.


client.js

nextBatch is triggered when there is data on the socket, it is parsed by the mqtt-packet lib (listening on 'packet' event)
then that data is sent to enqueue which parses the messages using handle (from ./handlers)


---
To blacklist certain messages from working, probably have to insert code in Aedes.prototype.subscribe

We can crete an arrow function that has the context around it and calls the func callback in case it is not blacklisted.

We have to store all the functions as they call the method to register a subscription, in a Map.
The functions are the keys and our own custom callback is the value.
This has to be stored so that the .removeListener can be called correctly (otherwise we won't be able to remove the listener if we don't have the function, as it is probably used as a key internally as well).

Maps can use functions as keys. Objects supposedly also can do this but the code is converted to a string so two functions with the same code will be considered the same key, which may be troublesome here.

---

To make the above work, we have to modify the calls to broker.(un)subscribe pass the client, so that we know the id...
