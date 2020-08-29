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


/**
 * THIS CURL COMMAND IS NOT CORRECT.  
 * SEE formData BELOW FOR THE CORRECT LIST OF FORM PARAMETERS PASSED IN

 */

 /**
  * Called from twilio-vodeo.js:twilioCallback()
  * This is where we download the composition file from twilio
  * When we're done, we make a post request back to the firebase function twilio-vodeo.js:downloadComplete()
  */
app.post('/downloadComposition', function(req, res) {
	// See twilio-telepatriot.js : twilioCallback() : the "composition-available" block
	/**
	 *  this is what we pass to this function from twilio-vodeo.js:twilioCallback()
	 * 
        var formData = {
			RoomSid: roomSid,
            twilio_account_sid: twilioAccountSid,
            domain: 'video.twilio.com',
            MediaUri: req.body.MediaUri,
            CompositionSid: req.body.CompositionSid,
            Ttl: 3600,
            firebase_functions_host: req.query.firebase_functions_host,
			firebase_function: '/downloadComplete',
            twilio_auth_token: twilioAuthToken
         };
	 */

    var twilioUrl = `https://${req.body.twilio_account_sid}:${req.body.twilio_auth_token}@${req.body.domain}${req.body.MediaUri}?Ttl=${req.body.Ttl}`
	var compositionFile = `~/videos/${req.body.CompositionSid}.mp4`


    // ref:  https://stackoverflow.com/questions/44896984/what-is-way-to-download-big-file-in-nodejs
    progress(request(twilioUrl, {/* parameters */}))
    .on('progress', function(state) {
	    /**
		 * We COULD call back to a firebase function as the file is downloading but I don't see the value in that
		 * right now  8/29/20
		 */
		/************** 
	    request.post({
				url: callbackUrl, // <- /downloadComplete would be the wrong url though
				formData:JSON.stringify({state: state})
	        },
		    function(err, httpResponse, body) {
		        if(err) {
			        res.send(JSON.stringify({error: err, when: 'during progress'}))
		        }
	        }
		)
		****************/
	})
	.on('error', function(err) {
	    if(err) {
	        res.send(JSON.stringify({error: err, when: 'on error'}))	
	    }
	})
	.on('end', function() {
		//res.send(JSON.stringify({response: 'download complete'}))
	})
	.pipe(
	    fs.createWriteStream(compositionFile).on('finish', function() {
			request.post(
				{
					url: `https://${req.body.firebase_functions_host}${req.body.firebase_function}`, 
					formData:JSON.stringify({compositionFile: compositionFile, 
											 RoomSid: req.body.RoomSid,
											 tempEditFolder:  `~/videos/${req.body.CompositionSid}`,
											 downloadComplete: true})
				},
				function(err, httpResponse, body) { 
					if(err) { 
						res.send(JSON.stringify({error: err, when: 'on finsish'})) 
					}	
				}
			)

			/************
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
			********************/
			res.send(JSON.stringify({compositionFile: compositionFile})) // could probably just return {res: 'ok'}
		})
	)
	
	
    res.send(JSON.stringify({response: 'ok'}))

}) // end app.get(/downloadComposition)


/**
 * Called from twilio-video.js:downloadVideo()
 * See the page "Marking Time"
 * See video-call.component.ts: the start stop pause and resume recording functions
 */
app.post('/cutVideo', function(req, res) {

	/*******
	 form data from twilio-video.js:downloadComplete()
	 
        let formData = {
            compositionFile: compositionFile,
            tempEditFolder: req.body.tempEditFolder,
            roomObj: roomObj
        }
	******/

	let mkdir = `mkdir ${req.body.tempEditFolder}`
    let ffmpegCommands = _.map(req.body.roomObj['mark_time'], (timeStuff, index) => {
		return `ffmpeg -i ${req.body.compositionFile} -ss ${timeStuff.start_recording} -t ${timeStuff.duration} ${req.body.tempEditFolder}/part${index}.mp4`
	})
	//let rmdir = `rm -rf ${req.body.tempEditFolder}`
	let commands = _.flatten( [mkdir, ffmpegCommands/*, rmdir  */] )



})


app.listen(7000, function() {
    console.log('app listeneing on port 7000')
})
