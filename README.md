[![Build Status](https://travis-ci.org/larvit/larvitamintercom.svg?branch=master)](https://travis-ci.org/larvit/larvitamintercom) [![Dependencies](https://david-dm.org/larvit/larvitamintercom.svg)](https://david-dm.org/larvit/larvitamintercom.svg)

# Larvitamintercom

Communication wrapper for rabbitmq in autobahn.

## Usage

### Send

send() to autobahn.

```javascript
const	Intercom	= require('larvitamintercom'),
	conStr	= 'amqp://user:password@192.168.0.1/',
	intercom	= new Intercom(conStr);

let	message	= {'hello':	'world'},
	options	= {'exchange':	'foo'}; // Will default to "default" if options is omitted

intercom.send(message, options, function(err, msgUuid) {
	// called when message is accepted by queue handler
	// msgUuid will be a unique UUID for this specific message
});
```

#### Default send options:

```javascript
{
	'exchange':	'default',
	'durable':	true,
	'forceConsumeQueue':	false // Will create a queue for consumtion even if there is no current listeners. This way no message will ever be lost, since they will wait in this queue until some consumer consumes them.
}
```

### Read

There are two types of read operations; "consume" and "subscribe".

A message can only be "consumed" once, but it can be "subscribed" several times, by different readers.

Consumers can be assigned to an exchanged after the message have been sent, and they still receive the message.
However, very importantly, ONE consumer must be assigned before the send happends, or the consumer queue never gets declared!

Subscribers, in contrast, must subscribe BEFORE the message is sent or they will not receive it.

Each subscriber only get each message once.

#### Consume

```javascript
const	Intercom	= require('larvitamintercom'),
	conStr	= 'amqp://user:password@192.168.0.1/',
	intercom	= new Intercom(conStr);

let	options = {'exchange': 'foo'}; // Will default to "default" if options is omitted

intercom.consume(options, function(message, ack, deliveryTag) {
	// message being the object sent with intercom.send()

	// deliveryTag is an identification of this delivery

	// Must be ran! Always! ACK!!
	ack();
	// or
	ack(new Error('Something was wrong with the message'));
}, function(err, consumeInstance) {
	// Callback from established consume connection

	// Stop consuming when your application is not interested any more
	setTimeout(function() {
		consumeInstance.cancel(function(err) {
			if (err) throw err;
			// IMPORTANT!!! This callback is syncronous and does NOT guarantee no more messages comes on the consume()
		});
	}, 3600000);
});
```

##### Default consume options:

```javascript
{
	'exchange':	'default'
}
```

#### Subscribe

```javascript
const	Intercom	= require('larvitamintercom').Intercom,
	conStr	= 'amqp://user:password@192.168.0.1/',
	intercom	= new Intercom(conStr);

let options = {'exchange': 'default'};

intercom.subscribe(options, function(message, ack, deliveryTag) {
	// message subscribe the object sent with intercom.send()

	// deliveryTag is an identification of this delivery

	// Must be ran! Always! ACK!!
	ack();
	// or
	ack(new Error('Something was wrong with the message'));
}, function(err, subscribeInstance) {
	// Callback from established subscribe connection

	// Stop consuming when your application is not interested any more
	setTimeout(function() {
		subscribeInstance.cancel(function(err) {
			if (err) throw err;
			// IMPORTANT!!! This callback is syncronous and does NOT guarantee no more messages comes on the subscribe()
		});
	}, 3600000);
});
```

##### Default subscribe options:

```javascript
{
	'exchange':	'default'
}
```
