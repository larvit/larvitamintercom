# Larvitamintercom

Communication wrapper for rabbitmq in autobahn.


### Send:
By default send() will also publish the same message to an exchange with the same name as the send que. Options is declared under this example.
```
const autobahnintercom = require('autobahntools').Intercom,
      connStr          = 'amqp://user:password@192.168.0.1/',
      intercom         = new autobahnintercom(connStr);

let message = {"msg":"Hello World"};

intercom.connection.then(function() {
  let options = {que: 'senderQue'};
  intercom.send(options, message);
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
const autobahnintercom = require('autobahntools').Intercom,
      connStr          = 'amqp://user:password@192.168.0.1/',
      intercom         = new autobahnintercom(connStr);

intercom.connection.then(function() {
  let options = {que: 'sendQue'};

  intercom.consume(options, function(msg) {
    // Do something with you recieved message.
  });
});
```

###### Default consume options:
```
{
  que: '',
  ack: false
}
```

### Subscribe:
```
const autobahnintercom = require('autobahntools').Intercom,
      connStr          = 'amqp://user:password@192.168.0.1/',
      intercom         = new autobahnintercom(connStr);

intercom.connection.then(function() {
  let options = {exchange: 'subscribeExchange'};

  intercom.subscribe(options, function(msg) {
    // Do something with you recieved message.
  });
});
```

###### Default subscribe options:
```
{
  exchange: '',
  durable: false,
  type: 'fanout',
  ack: false
}
```

### Publish:
The send() function will automatically publish the message that message that going to med sent to a regular que. How ever, if you want to publish a message without sending it to at regular que you can do that as well.
```
const autobahnintercom = require('autobahntools').Intercom,
      connStr          = 'amqp://user:password@192.168.0.1/',
      intercom         = new autobahnintercom(connStr);

let message = {"msg":"Hello World"};

intercom.connection.then(function() {
  let options = {exchange: 'publishExchange'};
  intercom.publish(options, message);
});
```

###### Default publish options:
```
{
  exchange: ''
}
```
