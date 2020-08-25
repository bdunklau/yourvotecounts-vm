var express = require('express')
var shell = require('shelljs')
var app = express()
var _ = require('lodash')
var request = require('request')
var progress = require('request-progress')
var fs = require('fs')

var bodyParser = require('body-parser')

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }))

// parse application/json
app.use(bodyParser.json())

app.get('/', function(req, res) {
	res.send(JSON.stringify({response: 'ok'}))
})

app.post('/publish', function(req, res) {
    // See twilio-telepatriot.js : twilioCallback() : the "composition-available" block
    var twilio_account_sid = req.body.twilio_account_sid
    var twilio_auth_token = req.body.twilio_auth_token
    var domain = req.body.domain
    var MediaUri = req.body.MediaUri
    var Ttl = req.body.Ttl
    var CompositionSid = req.body.CompositionSid
    var firebaseServer = req.body.firebaseServer
    var firebaseUri = req.body.firebaseUri
    var twilioUrl = 'https://'+twilio_account_sid+':'+twilio_auth_token+'@'+domain+MediaUri+'?Ttl='+Ttl
    var callbackUrl = 'https://'+firebaseServer+firebaseUri
    var compositionFile = '/home/bdunklau/videos/'+CompositionSid+'.mp4'
    var video_title = req.body.video_title
    var youtube_video_description = req.body.youtube_video_description
    var keywords = req.body.keywords
    var privacyStatus = req.body.privacyStatus
    var video_node_key = req.body.video_node_key
    var uid = req.body.uid

    // ref:  https://stackoverflow.com/questions/44896984/what-is-way-to-download-big-file-in-nodejs
    progress(request(twilioUrl, {/* parameters */}))
        .on('progress', function(state) {
	    // call back to /twilioCallback with progress updates
	    request.post(
		{url: callbackUrl,
		 formData:JSON.stringify({state: state})
	        },
		function(err, httpResponse, body) {
		    if(err) {
			res.send(JSON.stringify({error: err, when: 'during progress'}))
		    }
	        }
	    )
	})
	.on('error', function(err) {
	    if(err) {
	        res.send(JSON.stringify({error: err, when: 'on error'}))	
	    }
	})
	.on('end', function() {
	})
	.pipe(
	    fs.createWriteStream(compositionFile).on('finish', function() {
				request.post(
				{url: callbackUrl, formData:JSON.stringify({compositionFile: compositionFile, downloadComplete: true})},
				function(err, httpResponse, body) { 
					if(err) { res.send(JSON.stringify({error: err, when: 'on finsish'})) }	
					}
				)		

				var pythonScriptCallback = 'https://'+firebaseServer+'/video_processing_callback?video_node_key='+video_node_key

				// call the python script to upload the file
				var cmd = 'python3 /home/bdunklau/python/upload_video.py'
				cmd += ' --file="'+compositionFile+'"'
				cmd += ' --title="'+video_title+'"'
				cmd += ' --description="'+youtube_video_description+'"'
				cmd += ' --keywords="'+keywords+'"'
				cmd += ' --category="22" --privacyStatus="'+privacyStatus+'"'
				cmd += ' --callbackurl="'+pythonScriptCallback+'"'
				cmd += ' --uid="'+uid+'"'
				shell.exec(cmd, function(code, stdout, stderr) {
				// don't really care about this function because we passed 'callbackurl' as an arg to the python script
				})
				res.send(JSON.stringify({response: 'ok'}))
		    }
        )
    )
	
    //res.send(JSON.stringify({response: 'ok'}))

}) // end app.get(/publish)


app.listen(7000, function() {
    console.log('app listeneing on port 7000')
})
