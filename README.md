[![Build Status](https://travis-ci.org/larvit/larvitamintercom.svg?branch=master)](https://travis-ci.org/larvit/larvitamintercom) [![Dependencies](https://david-dm.org/larvit/larvitamintercom.svg)](https://david-dm.org/larvit/larvitamintercom.svg)

# Larvitamintercom

Communication wrapper for rabbitmq in autobahn.


### Send:
By default send() will also publish the same message to an exchange with the same name as the send que. Options is declared under this example.
```
const Intercom = require('larvitamintercom').Intercom,
      connStr  = 'amqp://user:password@192.168.0.1/',
      intercom = new Intercom(connStr);

let message = {"msg":"Hello World"};
    options = {que: 'senderQue'};

intercom.send(options, message, function() {
  // Do something when message is published.
  // (This is optional)
});
```

###### Default send options:
```
{
  que: '',
  exchange: this.que,
  durable: false,
  publish: true
}
```

### Consume:
```
const Intercom = require('larvitamintercom').Intercom,
      connStr  = 'amqp://user:password@192.168.0.1/',
      intercom = new Intercom(connStr);

let options = {que: 'sendQue'};

intercom.consume(options, function(msg) {
  // Do something with you recieved message.
}, function(err, result) {
  // Do something when consumption is established.
  // (This is optional)
});

```

###### Default consume options:
```
{
  que: '',
  ack: true
}
```

### Subscribe:
```
const Intercom = require('larvitamintercom').Intercom,
      connStr  = 'amqp://user:password@192.168.0.1/',
      intercom = new Intercom(connStr);

let options = {exchange: 'subscribeExchange'};

intercom.subscribe(options, function(msg) {
  // Do something with you recieved message.
}, function(err, result) {
  // Do something when subscription is established.
  // (This is optional)
});
```

###### Default subscribe options:
```
{
  exchange: '',
  durable: false,
  type: 'fanout',
  ack: true
}
```

### Publish:
The send() function will automatically publish the message that message that going to med sent to a regular que. How ever, if you want to publish a message without sending it to at regular que you can do that as well.
```
const Intercom = require('larvitamintercom').Intercom,
      connStr  = 'amqp://user:password@192.168.0.1/',
      intercom = new Intercom(connStr);

let message = {"msg":"Hello World"};
    options = {exchange: 'publishExchange'};

intercom.publish(options, message, function() {
  // Do something when message is published.
  // (This is optional)
});
```

###### Default publish options:
```
{
  exchange: '',
  type: 'fanout'
}
```
