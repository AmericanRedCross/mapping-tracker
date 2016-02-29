//General config
var flash = require('connect-flash');
var localConfig = require('./config');
var AppCtrl = require('./routes/app').Ctrl;
var Asset = require('./routes/app').Asset;
var moment = require('moment');
var fs = require('fs');
var path = require('path');


var ctrl = new AppCtrl('localhost', 27017);


//Authentication config
var User = require('./routes/app').User;
var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;
var JWT = require('jwt-simple');
var jwtauth = require('./auth.js');

passport.use('local-login',new LocalStrategy({
		usernameField:"username",
		passwordField:"password",
		passReqToCallback:true
	},
	function(req, username, password, done) {
        User.findOne({ 'username' :  username }, function(err, user) {
            if (err) {
                return done(err);
            }
            if (!user || !user.validPassword(password)) {
                return done(null, false, req.flash('loginMessage', 'Invalid username or password.'));
            }
            return done(null, user);
        });

    }
))

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    done(err, user);
  });
});

//Express config
var express = require('express');
var exphbs  = require('express3-handlebars');
var multer  = require('multer');
var morgan  = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var session = require('express-session');
var app = express();

app.use(morgan('dev'));     /* 'default', 'short', 'tiny', 'dev' */
app.use(bodyParser.urlencoded({
  extended: true
}));
// app.use(multer());
app.use(cookieParser());
app.use(session({
  secret: 'thisissecret',
  resave: true,
  saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.set("tokenSecret",jwtauth.tokenSecret);
app.set("json spaces",4);

app.engine('handlebars', exphbs({
	defaultLayout: 'main',
	helpers: {
		eq: function(v1,v2,options) {
			if (v1 && v2 && v1.toString() === v2.toString()) {
				return options.fn(this);
			}
			return options.inverse(this);
		},
		neq: function(v1,v2,options) {
			if (v1 && v2 && v1.toString() !== v2.toString()) {
				return options.fn(this);
			}
			return options.inverse(this);
		},
		log: function(context,options) {
			console.log(context);
			return true;
		},
		json: function(context) {
			return JSON.stringify(context);
		},
		string: function(context) {
			return context.toString();
		},
		formatDate: function(context,format) {
			return moment(context).format(format);
		},
		eachAtIndex: function(array,index,options) {
			var lookup;
			if (array && (index != undefined)) {
				lookup = array[index];
			}
			var output = "";
			if (lookup && lookup.length) {
				for (var i=0;i<lookup.length;i++) {
					var value = {
						value: lookup[i]
					}
					value["$first"] = (i==0);
					value["$last"] = (i==lookup.length-1);
					value["$index"] = i;
					output += options.fn(value);
				}
			}
			return output;
		},
		logos: function() {
			var output = "";
			var files = fs.readdirSync("client/media/logos");
			for (var i=0;i<files.length;i++) {
				var file = files[i];
				output+="<img src='/media/logos/"+file+"' class='logo'>";
			}
			return output;
		}
	},
	partials: {

	}
}))
app.set('view engine', 'handlebars');

app.use(express.static('client'));

app.post('/user/logout',function(req,res) {
	req.session.destroy(function() {
		res.redirect("/");
	})
})

app.post('/user/login',passport.authenticate('local-login', {
    failureRedirect: '/',
    failureFlash: true
}),function(req,res) {
	if (req.session.redirectTo) {
		res.redirect(req.session.redirectTo);
		delete req.session.redirectTo;
	} else {
		res.redirect("/");
	}
})

app.post('/user/:username',function(req,res) {
	if (req.user && req.user.permissions == "super") {
		switch(req.body["_method"]) {
			case "DELETE":
				ctrl.deleteUser(req,res);
			break;
			case "PUT":
				ctrl.updateUser(req,res);
			break;
			default:
				res.redirect("/");
			break;
		}
	} else {
		res.redirect("/");
	}
})

app.post('/user',function(req,res) {
	if (req.user && req.user.permissions == "super") {
		ctrl.createUser(req,res);
	} else {
		res.redirect("/");
	}
})

app.get('/users',function(req,res) {
	if (req.user && req.user.permissions == "super") {
		ctrl.getUsers(function(result) {
			res.render('listUsers',{
				user:req.user,
				users:result,
				opts:localConfig.page,
				error:req.flash("createMessage") || req.flash("editMessage") || req.flash("deleteMessage"),
				success:req.flash("successMessage"),
				edit:req.query.edit
			});
		})
	} else {
		req.session.redirectTo = "/users";
		res.redirect("/");
	}
})

function apiSucceed(req,payload) {
	var data = {
		success: true,
		response: payload
	}
	if (req.user) {
		if (!data.auth) {
			data.auth = {
				user:req.user.email
			}
		} else {
			data.auth.user = req.user.email;
		}
	}
	if (req.token) {
		if (!data.auth) {
			data.auth = {
				token:req.token
			}
		} else {
			data.auth.token = req.token;
		}
	}
	return data;
}

function apiFail(err) {
	return {
		success: false,
		error: err
	}
}

app.get('/api/user/:email',[jwtauth.auth],function(req,res) {
	res.header('Access-Control-Allow-Origin', '*');
	if (req.user && (req.user.permissions == "super" || req.user.email == req.params.email)) {
		ctrl.getUser(req.params.email,function(user) {
			if (user) {
				res.json(apiSucceed(req,user));
			} else {
				res.status(400).json(apiFail("No user with that email address or insufficient access."))
			}
		})
	} else {
		res.status(401).json(apiFail("Access denied."));
	}
})


var PostGresHelper = require("./routes/postGresHelper.js");
var pghelper = new PostGresHelper();

var Gpx = require("./routes/Gpx.js");
var gpx = new Gpx();

var ETL = require("./routes/ETL.js");
var etl = new ETL();

var storage =   multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, './tmp');
  },
  filename: function (req, file, callback) {
    callback(null, file.originalname.substr(0, file.originalname.lastIndexOf('.')) + '_' + Date.now() + path.extname(file.originalname));
  }
});
var upload = multer({ storage : storage }).array('gpxFiles');

app.post('/uploadgpx',function(req,res){
    upload(req,res,function(err) {
        if(err) {
            return res.end("Error uploading file.");
        }
				// console.log(req.body);
				// console.log(req.files);
				etl.run(req.files, function(err,data){
					res.end('Ran ETL.');
				});
    });
});

app.get('/query/distinct-file',function(req,res) {
	if (req.user) {
		var queryStr = "SELECT DISTINCT file FROM data.gpx;";
		console.log(queryStr)
		pghelper.query(queryStr, function(err, data){
			console.log('returned data: ' + data)
			res.send(data);
		})
	}
})

app.post('/query/gpx-single', function (req,res){
	if (req.user){
	var queryStr = "SELECT row_to_json(fc) "+
   "FROM ( SELECT 'FeatureCollection' As type, array_to_json(array_agg(f)) As features "+
   "FROM (SELECT 'Feature' As type "+
      ", ST_AsGeoJSON(lg.geom)::json As geometry"+
      ", row_to_json((SELECT l FROM (SELECT speed) As l"+
        ")) As properties "+
     "FROM data.gpx As lg WHERE file='" + req.body.file + "'  ) As f )  As fc;";

		pghelper.query(queryStr, function(err, data){
 			res.send(data[0]["row_to_json"]);
 		})
	}
})

app.post('/query/remove-file', function (req,res){
	if (req.user){
		gpx.removeFile(req.body.file, function(err, data){
			res.end();
		})
	}
})



app.get('/',function (req,res) {
	res.render('home',{
		user:req.user,
		opts:localConfig.page,
		error:req.flash("loginMessage")
	});
})

var S3Helper = require("./routes/s3Helper.js");
var s3helper = new S3Helper();

app.get('/gpx',function(req,res) {
	if (req.user) {
		s3helper.listGpx(function(err, data){
	    res.render('gpx', {
				user:req.user,
	      opts:localConfig.page,
	      listgpx:data,
				error:req.flash("loginMessage")
	    });
	  });
	} else {
		res.redirect("/");
	}
})

app.get('/mapping',function(req,res) {
	if (req.user) {
    res.render('mapping', {
			user:req.user,
      opts:localConfig.page,
			error:req.flash("loginMessage")
    });
	} else {
		res.redirect("/");
	}
})

app.get('/map',function(req,res) {
	if (req.user) {
    res.render('map', {
			user:req.user,
      opts:localConfig.page,
			error:req.flash("loginMessage")
    });
	} else {
		res.redirect("/");
	}
})


app.listen(localConfig.application.port);
console.log('Listening on port '+localConfig.application.port);
