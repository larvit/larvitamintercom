# Autobahntools

## Intercom
Communication wrapper for rabbitmq in autobahn.

### Usage

#### Consume:
```
const autobahnintercom = require('autobahntools').Intercom,
      intercom         = new autobahnintercom(conStr, 'consumerQue');

intercom.connection.then(function() {
intercom.consume({ack: true, que: 'consumerQue'}, function(msg) {
    // Do something with you recieved message.
  });
});
```

#### Send:
```
const autobahnintercom = require('autobahntools').Intercom,
      intercom         = new autobahnintercom(conStr, 'senderQue');

let message = {"msg":"Hello World"};

intercom.connection.then(function() {
  intercom.send({que: 'senderQue'}, message);
});
```
