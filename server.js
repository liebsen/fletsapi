const fs = require('fs')
var express = require('express');
var bcrypt = require('bcrypt');
var path = require('path');
var axios = require('axios');
var app = express();
var cors = require('cors');
var http = require('http').Server(app);
var io = require('socket.io')(http, { origins: '*:*'});
var moment = require('moment');
var mongodb = require('mongodb');
var expressLayouts = require('express-ejs-layouts')
var bodyParser = require('body-parser')
const mercadopago = require ('mercadopago');
var onlinewhen = moment().utc().subtract(10, 'minutes')
var emailHelper = require('./email/helper')
var emailClient = emailHelper(null,{
  from:'"FletsApp" <no-reply@fletsapp.com>'
})
var gamesort = {date:-1}
var allowedOrigins = [
  'http://localhost:4000',
  'https://localhost:8080',
  'https://fletsapp.com',
  'https://fletsapp.herokuapp.com'
]

mercadopago.configure({
  access_token: process.env.MP_TOKEN
});

app.use(cors({
  origin: function(origin, callback){
    // allow requests with no origin 
    // (like mobile apps or curl requests)
    if(!origin) return callback(null, true)
    if(allowedOrigins.indexOf(origin) === -1){
      var msg = 'The CORS policy for this site does not ' +
                'allow access from the specified Origin.'
      return callback(new Error(msg), false)
    }
    return callback(null, true)
  }
}))

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*"); // update to match the domain you will make the request from
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json({ type: 'application/json' }))
app.set('views', path.join(__dirname, 'static'))
app.use(express.static(path.join(__dirname, 'static')))
app.set('view engine', 'ejs')
app.use(expressLayouts)

var random_code = function (factor){ 
  return Math.random().toString(36).substring(2, factor) + Math.random().toString(36).substring(2, factor)
}

mongodb.MongoClient.connect(process.env.MONGO_URL, {useNewUrlParser: true }, function(err, database) {
  if(err) throw err

  const db = database.db(process.env.MONGO_URL.split('/').reverse()[0])

  app.get('/', function (req, res) {
    res.render('index')
  });

  app.post('/flet/estimate', function (req, res) {  

    // unique user hardcode settings
    // calculo manual de cotizacion
    // todo : hacerlo dinamico

    const preference = {
      distance: {
        basic: 20, // Distancia básica en kms
        max: 50, // Maximo en kms
        price : 700, // Tarifa básica en ARS
        karma : 38 // Precio por unidad por exceso del básico
      },
      weight: {
        basic: 100, // Peso básico en kg
        max: 500, // Maximo en kg
        price: 150, // Tarifa básica en ARS
        karma : 3 // Precio por unidad por exceso del básico
      }
    }

    // todo: refactor cost feature vector
    // ie: price + (value - basic) * karma

    // distance
    let distance = Math.round(req.body.ruta.distance.value/1000) // in km
    var delta = distance - preference.distance.basic;

    if(delta < 0){
      delta = 0;
    }

    let dpart = preference.distance.price + delta * preference.distance.karma;

    // weight 
    delta = req.body.carga.peso - preference.weight.basic;

    if(delta < 0){
      delta = 0;
    }

    let wpart = preference.weight.price + delta * preference.weight.karma;
    let estimate = parseFloat(Math.round(dpart + wpart)).toFixed(2);
    let data = {
      status: 'success',
      amount: estimate,
      currency: 'ARS'
    }
    return res.json(data)
  })

  app.post('/flet/preference', function (req, res) {  
    // Crea un objeto de preferencia
    let preference = {
      items: [
        {
          title: 'Mi Flet',
          unit_price: req.body.estimate.amount,
          quantity: 1,
        }
      ]
    };

    mercadopago.preferences.create(preference)
      .then(function(response){
      // Este valor reemplazará el string "$$init_point$$" en tu HTML
        //global.init_point = response.body.init_point;
        return res.json(response.body)
      }).catch(function(error){
        console.log(error);
      });      
  })

  app.post('/flet/directions', function (req, res) {  
    axios.get( 'https://maps.googleapis.com/maps/api/directions/json?origin=' + req.body.from.lat + ',' + req.body.from.lng + '&destination=' + req.body.to.lat + ',' + req.body.to.lng + '&mode=driving&key=' + process.env.API_KEY, {} ).then((response) => {
      return res.json(response.data)
    }).catch((err) => {
      return res.json(err)
    })
  })

  app.post('/account/create', function (req, res) {  
    bcrypt.hash(req.body.passwordsignup, saltRounds, function (err,   hash) {
      db.collection('accounts').findOneAndUpdate({
        name: req.body.usernamesignup,   
        email: req.body.emailsignup,   
        password: hash   
      },
      {
        "$set": {
          name: req.body.usernamesignup,   
          email: req.body.emailsignup,   
          password: hash,  
          date:moment().utc().format('YYYY.MM.DD'),
          role: 'provider'
        }
      },{ 
        upsert: true, 
        'new': true, 
        returnOriginal:false 
      }).then(function(data) {    
        if (data) {   
          emailClient.send({
            to:updatedShipment.shipper_email,
            subject:'Ups! Nos figura pendiente tu pago para comenzar con tu envio. ',
            data:{
              title:'Confirmá el pago de tu envio',
              message:'Hola! Te recordamos que todos nuestros envíos comienzan una vez realizado el pago correspondiente. <br /> <br />Todavía estas a tiempo de que comencemos con tu envio si lo abonas antes de las 15:00hs sino lo enviaremos el día siguiente cuando procesamos el pago. =) ',
              link: cfg.senders.WEBSITE_HOST + '/tu-envio.html?id='+updatedShipment.id,
              linkText:'Ver el estado de mi envío'
            },
            templatePath:cfg.senders.emailsTemplatePath
          }).catch(function(err){
            if(err) console.log(err)
          }).then(function(){
            return res.json({ 
              status : 'success', 
              data:data
            })
          })
        }  
      }); 
    });
  });

  app.post('/flet/create', function (req, res) { 
    const room = random_code(16)
    db.collection('flets').find({room:room}).toArray(function(err,doc){
      if(!doc.length){
        const secret_room = random_code(16)
        db.collection('flets').findOneAndUpdate(
        {
          room:room
        },
        {
          "$set": {
            room:room,
            secret_room:secret_room,
            date:moment().utc().format('YYYY.MM.DD'),
            event: 'Online game',
            views: 1
          }
        },{ 
          upsert: true, 
          'new': true, 
          returnOriginal:false 
        }).then(function(doc){
          return res.json({ 
            status : 'success', 
            secret_room:secret_room, 
            room: room
          })
        })
      } else {
        return res.json({ status : 'danger', message : 'cannot_create_room_twice'})
      }
    })
  });

  app.get('/flet/:secret/:room', function (req, res) { 
    if(!req.params.secret||!req.params.room) return res.json({status:'error',message:'not_enough_params'})
    db.collection('games').findOneAndUpdate(
    {
      room:req.params.room
    },
    {
      "$set": {
        room:req.params.room,
        secret_room:req.params.secret
      }
    },{ 
      upsert: true, 
      'new': true, 
      returnOriginal:false 
    }).then(function(){
      res.json({status:'success'})
    })
  });

  app.post('/flet', function (req, res) { 
    db.collection('games').find(req.body).toArray(function(err,docs){
      var game = {}
      if(docs[0]){
        game = docs[0]
        delete game.secret_room 
        delete game.live_url 
      }
      return res.json(game)
    })   
  })

  app.post('/topten', function (req, res) { 
    var $or = []
    , limit = 3
    , offset = 0

    for(var i in req.body){
      $or.push({'black': {'$regex' : req.body[i], '$options' : 'i'}})  
      $or.push({'white': {'$regex' : req.body[i], '$options' : 'i'}})  
    }

    db.collection('games').find({"$or": $or})
    .sort(gamesort)
    .limit(limit)
    .skip(offset)
    .toArray(function(err,docs){
      return res.json(docs)
    })   
  })

  app.post('/fletcount', function (req, res) { 
    db.collection('games').find(req.body).toArray(function(err,docs){
      return res.json(docs.length)
    })
  })

  app.post('/search', function (req, res) { 
    if(!req.body.query) return res.json({'error':'not_enough_params'})
    var $or = []
    , limit = parseInt(req.body.limit)||25
    , offset = parseInt(req.body.offset)||0
    , query = unescape(req.body.query)

    query.split(' ').forEach((word) => {
      $or.push({"white": {'$regex' : word, '$options' : 'i'}})
      $or.push({"black": {'$regex' : word, '$options' : 'i'}})
      $or.push({"event": {'$regex' : word, '$options' : 'i'}})
      $or.push({"site": {'$regex' : word, '$options' : 'i'}})
      $or.push({"date": {'$regex' : word, '$options' : 'i'}})
      $or.push({"pgn": {'$regex' : word, '$options' : 'i'}})
    })

    db.collection('games').countDocuments({"$or": $or}, function(error, numOfDocs){
      db.collection('games').find({"$or": $or})
        .sort(gamesort)
        .limit(limit)
        .skip(offset)
        .toArray(function(err,docs){
          return res.json({games:docs,count:numOfDocs})
        })   
    })
  })

  app.post('/loadpgn', function (req, res) {
    if(!req.body.room) return res.json({'error':'no_room_provided'})
    db.collection('games').findOneAndUpdate(
    {
      room: req.body.room
    },
    {
      "$set": req.body
    },{ upsert: true, 'new': true, returnOriginal:false }).then(function(doc){
      return res.json({ success: 1 })
    })    
  })

  app.get('*', function (req, res) { 
    const pathurl = [path.join(__dirname, 'static'),req.path+'.ejs'].join('')
    const pathname = req.path.split('/').join('')
    const query = req.query
    fs.stat(pathurl, function(err, stat) {
      if(err == null) {
        res.render(pathname,{query: query})
      } else {
        db.collection('games').findOneAndUpdate(
        {
          room:pathname
        },
        {
          "$inc": {
            views : 1
          }
        },{ upsert: false, new: true }).then(function(doc){
          if(doc.value){
            if(doc.value.updatedAt && doc.value.broadcast && moment(doc.value.updatedAt).format('x') > onlinewhen.format('x')) {
              res.json({status:'success',render:'watch',game:doc.value})
            } else {
              res.json({status:'success',render:'game',game:doc.value})
            }
          } else {
            res.json({status:'error'})
          }
        })
      }
    });
  })

  io.on('connection', function(socket){ //join room on connect
    socket.on('join', function(room) {
      socket.join(room);
      console.log('user joined room: ' + room);
    });

    socket.on('move', function(move) { //move object emitter
      var moveObj = move
      moveObj.updatedAt = moment().utc().format()
      return db.collection('games').findOneAndUpdate(
      {
        room:moveObj.room
      },
      {
        "$set": moveObj
      },{ new: true }).then(function(doc){
        console.log(moveObj.room + '- user moved: ' + JSON.stringify(move));
        io.emit('move', move);
      })
    });

    socket.on('data', function(data) { //move object emitter
      var dataObj = data
      dataObj.updatedAt = moment().utc().format()      
      return db.collection('games').findOneAndUpdate(
      {
        room:data.room
      },
      {
        "$set": dataObj
      },{ new: true }).then(function(doc){
        console.log(dataObj.room + '- data updated: ' + JSON.stringify(data));
        io.emit('data', data);
      })
    });

    socket.on('undo', function() { //undo emitter
      console.log('user undo');
      io.emit('undo');
    });

    socket.on('chat', function(data) { //move object emitter
      console.log('chat');
      io.emit('chat', data);
    });    
  });

  var server = http.listen(process.env.PORT, function () { //run http and web socket server
    var host = server.address().address;
    var port = server.address().port;
    console.log('Server listening at address ' + host + ', port ' + port);
  });
});