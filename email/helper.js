var nodemailer = require('nodemailer');
var mustache = require('mustache');
var fs = require('fs');
var _ = require('lodash');

// Backup SMTP config. Comment forced from
// var defaultSMTPConfig = {
//   host: 'smtp-pulse.com',
//   port: 2525,
//   tls: { rejectUnauthorized: false },
//   auth: {
//     user: 'qzapaia+2@gmail.com',
//     pass: 'bZk3tafK8KjrT3F'
//   }
// }
var defaultSMTPConfig = {
  host: 'smtp.sendgrid.net',
  port: 587,
  auth: {
    user: 'waaws',
    pass: 'FhiFzXAkzhu[AXfE4GWTwrYH'
  }
}

var defaultEmailConfig = {
  from:'"Contacto" <marce@waaws.space>',
	subject:'',
	template:'',
  data:{}
}


var Client = function(config, emailsConfig){
  this.defaultEmailConfig = emailsConfig || defaultEmailConfig;
  this.transport = nodemailer.createTransport(config || defaultSMTPConfig);
}


Client.prototype.send = function (emailConfig) {
  var that = this;
  if(!emailConfig) throw 'email config is required';

  emailConfig = _.defaults(emailConfig, this.defaultEmailConfig);

  // Just for the backup smtp
  if(defaultSMTPConfig.host == 'smtp-pulse.com'){
    emailConfig.from = '"Website Email" <marce@waaws.space>';
  }

  if(emailConfig.templatePath){
    emailConfig.template = fs.readFileSync(emailConfig.templatePath).toString();
  }

  if(!emailConfig.template){
    emailConfig.template = '{{#data}} <h3>{{key}}</h3> {{value}} <hr/> {{/data}}';
    emailConfig.data = {
      data:Object.keys(emailConfig.data).map(function(k){
        return {
          key:k,
          value:emailConfig.data[k]
        }
      })
    }
  }

  return (new Promise(function(resolve,reject){
    that.transport.sendMail({
      from: emailConfig.from,
      to: emailConfig.to,
      subject: mustache.render(emailConfig.subject, emailConfig.data),
      html: mustache.render(emailConfig.template, emailConfig.data),
      attachments: emailConfig.files
    },function(error, response){
      return error ? reject(error) : resolve(response);
    });
  }))

};

module.exports = function(smtpConfig,emailsConfig){
  return new Client(smtpConfig,emailsConfig);
}
exports.client = Client;

// test

// var test = module.exports();
// test.send({
//   to:'marce@waaws.space',
//   subject:'Test',
//   template:'test'
// }).then(function(){
//   console.log(arguments)
// }).catch(function(){
//   console.log(arguments)
// })
