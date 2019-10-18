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
var emailClient = emailHelper()
var nodeMailer = require('nodemailer')
var gamesort = {date:-1}
var allowedOrigins = [
  'http://localhost:4000',
  'https://localhost:8080',
  'https://fletsapp.com',
  'https://fletsapp.herokuapp.com'
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

  app.get('/', function (req, res) {
    res.render('index')
  });

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
      //amount: amount,
      amount: 10.00,
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
      // check if notification exists
      db.collection('preferences').find({payment_id:req.body.data.id}).toArray(function(err, result) {
        if(result.length === 0){
          axios.get('https://api.mercadopago.com/v1/payments/' + req.body.data.id + '?access_token=' + process.env.MP_TOKEN, {} ).then((response) => {
            db.collection('preferences').findAndModify(
            {
              payment_id:req.body.data.id
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
                emailClient.send({
                  //to:'mafrith@gmail.com',
                  to:'telemagico@gmail.com',
                  subject:'Tenés un envío de FletsApp',
                  data:{
                    title:'Marina: Te salió un envío!',
                    message: 'Nombre: ' + preference.value.datos.nombre + '<br>Teléfono : ' + preference.value.datos.telefono + '<br>Pasar a buscar en: ' + preference.value.ruta.from.formatted_address + '<br>Entregar en : ' + preference.value.ruta.to.formatted_address + '<br>',
                    link: process.env.APP_URL + '/envio/' + notification.value.external_reference,
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
          }).catch((err) => {
            return res.json(err)
          })
        } else {
          res.sendStatus(200)
        }
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


  // admin panel. todo: add auth

  app.get('/panel', function (req, res) { 
    db.collection('preferences').find({}).toArray(function(err, data) {

      var approved = 0
      var rejected = 0
      var preferences = 0

      data.forEach((preference) => {
        if(preference.payment_status === 'approved'){
          approved++
        } else if(preference.payment_status === 'rejected'){
          rejected++
        } else if(!preference.payment_status){
          preferences++
        } else {
        }
      })
      res.render('panel',{
        approved: approved,
        rejected: rejected,
        preferences: preferences
      })
    })
  })

  app.get('/panel/flets', function (req, res) { 
    db.collection('preferences').find({payment_status:{$ne:null}}).toArray(function(err, data) {
      res.render('flets',{data: data})
    })
  })

  app.get('/panel/preferencias', function (req, res) { 
    db.collection('preferences').find({payment_status:null}).toArray(function(err, data) {
      res.render('preferencias',{data: data})
    })
  })

  app.get('/panel/pagos', function (req, res) { 
    db.collection('notifications').find({}).toArray(function(err, data) {
      res.render('pagos',{data: data})
    })
  })

  var server = http.listen(process.env.PORT, function () { //run http and web socket server
    var host = server.address().address;
    var port = server.address().port;
    console.log('Server listening at address ' + host + ', port ' + port);
  });
});