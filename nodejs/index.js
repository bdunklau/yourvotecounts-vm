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
app.get('/downloadComposition', function(req, res) {

    var twilioUrl = `https://${req.query.twilio_account_sid}:${req.query.twilio_auth_token}@video.twilio.com${req.query.MediaUri}?Ttl=${req.query.Ttl}`
	var compositionFile = `/home/bdunklau/videos/${req.query.CompositionSid}.mp4`


    // ref:  https://stackoverflow.com/questions/44896984/what-is-way-to-download-big-file-in-nodejs
    progress(request(twilioUrl, {/* parameters */}))
    .on('progress', function(state) {
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
			return res.send(JSON.stringify({compositionFile: compositionFile})) // could probably just return {res: 'ok'}
		})
	)

}) 



app.post('/downloadCompositionORIG', function(req, res) {
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
			/**********************
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
            ***********************/
			res.send(JSON.stringify({compositionFile: compositionFile})) // could probably just return {res: 'ok'}
		})
	)
	
	
    //res.send(JSON.stringify({response: 'ok'}))

}) // end app.get(/downloadComposition)






/**
 * Called from twilio-video.js:downloadVideo()
 * See the page "Marking Time"
 * See video-call.component.ts: the start stop pause and resume recording functions
 */
app.all('/cutVideo', function(req, res) {
	if(req.query.test) {
		res.status(200).send(JSON.stringify({"test": req.query.test}))
		return
	}

	/*******
	 form data from twilio-video.js:downloadComplete()
	 
        let formData = {
            compositionFile: compositionFile,
            tempEditFolder: req.body.tempEditFolder,
            roomObj: roomObj
        }
	******/

	let mkdir = `mkdir ${req.body.tempEditFolder}`
	console.log('req.body = ', req.body);
	console.log('req.body.roomObj = ', req.body.roomObj);
    let ffmpegCommands = _.map(req.body.roomObj['mark_time'], (timeStuff, index) => {
		return `ffmpeg -i ${req.body.compositionFile} -ss ${timeStuff.start_recording} -t ${timeStuff.duration} ${req.body.tempEditFolder}/part${index}.mp4`
	})
	
	/**
	 * Creates an inputs.txt file that has this:
	 * file 'part0.mp4'
	 * file 'part1.mp4'
	 * file 'part2.mp4'
	 * etc
	 */
    let buildInputsFile = _.map(req.body.roomObj['mark_time'], (timeStuff, index) => {
		return `echo "file 'part${index}.mp4'" >> ${req.body.tempEditFolder}/inputs.txt`
	})

	let compFileWithoutMP4 = req.body.compositionFile.substring(0, req.body.compositionFile.indexOf(".mp4"))
	let concatCommand = `ffmpeg -f concat -i ${req.body.tempEditFolder}/inputs.txt -c copy ${compFileWithoutMP4}-output.mp4`

	let rmdir = `rm -rf ${req.body.tempEditFolder}`
	let commands = _.flatten( [mkdir, ffmpegCommands, `touch ${req.body.tempEditFolder}/inputs.txt`, buildInputsFile, concatCommand, rmdir] )

	_.each(commands, command => {
		console.log('command: ', command)
	})

	let commandRes = []
	_.each(commands, command => {
		if (shell.exec(command).code !== 0) {
		  shell.echo(`Error at this command: "${command}"`)
		  shell.exit(1)
		  commandRes.push(command)
		}

	})

    return res.status(200).send(JSON.stringify({commands: commands}))
})


app.all('/tempDownload', function(req, res) {
	const file = `/home/bdunklau/videos/${req.query.file}`;
	res.download(file); // Set disposition and send it.
});


app.listen(7000, function() {
    console.log('app listening on port 7000')
})
