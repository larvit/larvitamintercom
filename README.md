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

intercom.send(message, options, function(err) {
	// called when message is accepted by queue handler
}, function(err) {
	// called when all consumeres have acked the message
});
```

#### Default send options:

```javascript
{
	'exchange':	'default',
	'durable':	true
}
```

### Read

There are two types of read operations; "consume" and "subscribe".

A message can only be "consumed" once, but it can be "subscribed" several times, by different readers.

Consumers can be assigned to an exchanged after the message have been sent, and they still receive the message.

Subscribers, in contrast, must subscribe BEFORE the message is sent or they will not receive it.

Each subscriber only get each message once.

#### Consume

```javascript
const	Intercom	= require('larvitamintercom'),
	conStr	= 'amqp://user:password@192.168.0.1/',
	intercom	= new Intercom(conStr);

let options = {'exchange': 'foo'}; // Will default to "default" if options is omitted

intercom.consume(options, function(message, ack, rawMsg) {
	// message being the object sent with intercom.send()
	// rawMsg being an object with lots of stuff directly from RabbitMQ
	// message === JSON.parse(rawMsg.content.toString())

	// Must be ran! Always! ACK!!
	ack();
	// or
	ack(new Error('Something was wrong with the message'));
}, function(err, result) {
	// Callback from established consume connection
	// TODO: find out what result is
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

intercom.consume(options, function(message, ack, rawMsg) {
	// message subscribe the object sent with intercom.send()
	// rawMsg being an object with lots of stuff directly from RabbitMQ
	// message === JSON.parse(rawMsg.content.toString())

	// Must be ran! Always! ACK!!
	ack();
	// or
	ack(new Error('Something was wrong with the message'));
}, function(err, result) {
	// Callback from established subscribe connection
	// TODO: find out what result is
});
```

##### Default subscribe options:

```javascript
{
	'exchange':	''
}
```
