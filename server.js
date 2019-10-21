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
var mercadopago = require ('mercadopago');
var onlinewhen = moment().utc().subtract(10, 'minutes')
var emailHelper = require('./email/helper')
var emailClient = emailHelper()
var nodeMailer = require('nodemailer')
var jwt = require('jsonwebtoken')
const saltRounds = 10;
const allowedOrigins = [
  'http://localhost:4000',
  'https://localhost:8080',
  'https://fletsapp.herokuapp.com',
  'https://fletsapi.herokuapp.com',
  'https://fletsapp.com'  
]

mercadopago.configure({
  //sandbox: true,
  //access_token: process.env.MP_TOKEN_TEST
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

  app.post('/flet/estimate', function (req, res) {  

    // unique user hardcode settings
    // calculo manual de cotizacion
    // todo : hacerlo dinamico para plataforma

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
    let amount = parseFloat(Math.round(dpart + wpart)).toFixed(2);

    const estimate = {
      amount: amount,
      //amount: 10.00,
      currency: 'ARS'
    }

    req.body.estimate = estimate

    db.collection('preferences').insertOne(req.body, function(err,doc){
      let data = {
        id: doc.insertedId,
        status: 'success',
        estimate: estimate
      }

      return res.json(data)
    })
  })

  app.post('/flet/preference', function (req, res) {  
    // Crea un objeto de preferencia
    var ObjectId = require('mongodb').ObjectId; 
    db.collection('preferences').find({'_id': new ObjectId(req.body.id)}).toArray(function(err, results) {
      if(results.length && results[0].estimate.amount){
        let preference = {
          items: [
            {
              id: req.body.id,
              title: 'Envío con FletsApp',
              description: "",
              unit_price: parseFloat(results[0].estimate.amount),
              currency_id: "ARS",
              quantity: 1
            }
          ],
          notification_url: req.protocol + '://' + req.get('host') + "/mercadopago/notification",
          external_reference: req.body.id
        };

        mercadopago.preferences.create(preference).then(function(response){
          return res.json(response.body)
        }).catch(function(error){
          console.log("mercadopago error: ");
          console.log(error);
        })
      } else {
        return res.json({
          status: 'error'
        })
      }
    })
  })

  app.post('/mercadopago/notification', function (req, res) { 
    if(req.body.data){
      axios.get('https://api.mercadopago.com/v1/payments/' + req.body.data.id + '?access_token=' + process.env.MP_TOKEN, {} ).then((response) => {
        // check if notification exists
        var ObjectId = require('mongodb').ObjectId; 
        db.collection('preferences').findOneAndUpdate(
        {
          '_id': new ObjectId(response.data.external_reference)
        },
        {
          "$set": {
            mercadopago : response.data
          }
        },{ 
          upsert: true, 
          'new': true, 
          returnOriginal:false 
        }).then(function(preference){
          if(preference.value.mercadopago.status === 'approved'){
            console.log('sending email...')
            emailClient.send({
              to:'mafrith@gmail.com',
              //to:'telemagico@gmail.com',
              subject:'Tenés un envío de FletsApp',
              data:{
                title:'Marina: Te salió un envío!',
                message: 'Nombre: ' + preference.value.datos.nombre + '<br>Teléfono : ' + preference.value.datos.telefono + '<br>Pasar a buscar en: ' + preference.value.ruta.from.formatted_address + '<br>Entregar en : ' + preference.value.ruta.to.formatted_address + '<br>',
                link: process.env.APP_URL + '/envio/' + preference.value.mercadopago.external_reference,
                linkText:'Ver detalle del envío'
              },
              templatePath:path.join(__dirname,'/email/template.html')
            }).then(function(){
              res.sendStatus(200)
            }).catch(function(err){
              if(err) console.log(err)
              res.sendStatus(200)
            })
          }
        }).catch((err) => {
          return res.json(err)
        })
      })
    } else {
     res.sendStatus(200)
    }
  })  

  app.post('/procesar-pago', function (req, res) { 
    res.redirect(process.env.APP_URL + '/pago-completado/' + req.body.payment_status)
  })

  app.post('/contact', function (req, res) {  
    emailClient.send({
      to:'mafrith@gmail.com',
      //to:'telemagico@gmail.com',
      subject:'Contacto desde FletsApp',
      data:{
        title:'Contacto desde FletsApp',
        message: 'Nombre: ' + req.body.first_name + '<br>Apellido : ' + req.body.last_name + '<br>Email: ' + req.body.email + '<br>Comentarios : ' + req.body.comment + '<br>'
        //link: process.env.APP_URL + '/contact/' + notification.value.external_reference,
        //linkText:'Ver detalle del envío'
      },
      templatePath:path.join(__dirname,'/email/template.html')
    }).then(function(){
      res.json({
        status: 'success'
      })
    }).catch(function(err){
      if(err) console.log(err)
      res.json({
        status: 'error'
      })
    })    
  })

  app.post('/flet/directions', function (req, res) {  
    axios.get( 'https://maps.googleapis.com/maps/api/directions/json?origin=' + req.body.from.lat + ',' + req.body.from.lng + '&destination=' + req.body.to.lat + ',' + req.body.to.lng + '&mode=driving&key=' + process.env.API_KEY, {} ).then((response) => {
      return res.json(response.data)
    }).catch((err) => {
      return res.json(err)
    })
  })

  app.post('/account/login', (req, res) => {
    var username = req.body.user
    var password = req.body.password
    db.collection('accounts').findOne({
      username: username
    },function(err, user) {
      if (err) return res.status(500).send('Error on the server.');
      if (!user) return res.status(404).send('No user found.');
      let passwordIsValid = bcrypt.compareSync(req.body.password, user.password);
      if (!passwordIsValid) return res.status(401).send({ auth: false, token: null });
      let token = jwt.sign({ id: user._id }, process.env.APP_SECRET, {
          expiresIn: 86400 // expires in 24 hours
      });
      res.status(200).send({ auth: true, token: token, user: user });
    })
  })

  app.post('/account/create', function (req, res) {  
    var email = req.body.email
    var password = req.body.password
    var name = req.body.name
    var code = req.body.code
    var validation_code = random_code(32)

    bcrypt.hash(password, saltRounds, function (err, hash) {
      db.collection('accounts').findOneAndUpdate({
        code: code
      },
      {
        "$set": {
          code: null,
          email: email,
          password: hash,
          name: name,
          validation_code: validation_code,
          validation_date: null,
          registration_date: moment().utc().format('YYYY.MM.DD'),
          role: 'provider'
        }
      },{ 
        upsert: true, 
        'new': true, 
        returnOriginal:false 
      }).then(function(data) {    
        emailClient.send({
          to:email,
          subject:'Bienvenido ' + data.name,
          data:{
            title:'Confirmá la creación de tu cuenta',
            message:'Hola! Por favor valida tu cuenta ahora para poder usar FletsApp',
            link: req.protocol + '://' + req.get('host') + '/account/validate?code=' + code,
            linkText:'Validar mi cuenta'
          },
          templatePath:path.join(__dirname,'/email/template.html')
        }).catch(function(err){
          if(err) console.log(err)
        }).then(function(){
          res.status(200).send({ status: 'success' });
        })
      }).catch((err) => {
        res.status(404).send('No code found.');
      }) 
    });
  });

  app.post('/account/validate', function (req, res) {  
    db.collection('accounts').findOneAndUpdate({
      code: req.body.code
    },
    {
      "$set": {
        validated: "yes",
        validated_date: moment().utc().format('YYYY.MM.DD')
      }
    },{ 
      upsert: true, 
      'new': true, 
      returnOriginal:false 
    }).then(function(data) {  
      let token = jwt.sign({ id: user.id }, config.secret, {
          expiresIn: 86400 // expires in 24 hours
      });
      res.status(200).send({ auth: true, token: token, user: user });
    }).catch(function(err){
      if(err) return res.status(500).send("There was a problem getting user")
    })
  })

  // admin panel. todo: add auth

  app.get('/panel', function (req, res) { 
    res.render('panel')
  })

  app.get('/panel/flets', function (req, res) { 
    res.render('flets')
  })

  app.get('/panel/preferencias', function (req, res) { 
    res.render('preferencias')
  })

  app.get('/panel/pagos', function (req, res) { 
    res.render('pagos')
  })

  app.post('/panel/search', function (req, res) { 
    if(!req.body) return res.json({'error':'not_enough_params'})
    var body = JSON.parse(req.body.data)
    , limit = parseInt(body.limit)||50
    , offset = parseInt(body.offset)||0
    console.log(body)
    db.collection('preferences').countDocuments(body.find, function(error, numOfResults){
      db.collection('preferences').find(body.find)
        .sort({_id:-1})
        .limit(limit)
        .skip(offset)
        .toArray(function(err,results){
          return res.json({results:results,count:numOfResults})
        })   
    })
  })

  app.get('/', function (req, res) {
    res.render('index')
  })

  var server = http.listen(process.env.PORT, function () { //run http and web socket server
    var host = server.address().address;
    var port = server.address().port;
    console.log('Server listening at address ' + host + ', port ' + port);
  });
});