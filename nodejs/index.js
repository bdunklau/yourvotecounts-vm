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
    listDockers2(res)
})

app.get('/create-another-docker', function(req, res) {
	createAnotherDocker(res)
})

app.get('/stop-and-remove', function(req, res) {
	stopAndRemove(res)
})

app.get('/dockers', function(req, res) {
	shell.exec('~/scripts/dockers', function(code, stdout, stderr) {
		var dockerJson = dockersAsJson(getDockers(stdout))
		res.send(dockerJson)
	})
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
	    fs.createWriteStream(compositionFile)
	        .on('finish', function() {
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



app.get('/publish-orig', function(req, res) {
    var cmd = 'docker exec '+req.query.docker_name+' sh -c "cd /root/scripts; python ./upload_video.py --file=\\"/opt/vidyo/recording.flv\\" --title=\\"'+req.query.title+'\\" --description=\\"'+req.query.description+'\\" --keywords=\\"\\" --category=\\"22\\" --privacyStatus=\\"unlisted\\" --callbackurl=\\"'+req.query.callbackurl+'\\" --uid=\\"'+req.query.uid+'\\""'
	shell.exec(cmd, function(code, stdout, stderr) {
		// WE DON'T CARE ABOUT THE CALLBACK FUNCTION BECAUSE
	    // WE PASSED IN A callbackurl
        //if(stderr && stderr != '') {
		//	res.send('Error: '+stdout+'<P/>for this command: '+cmd)	
		//}
		//else res.send(stdout)
	})
	res.send('upload has started.  when finished, this url will be notified:<br/>'+req.query.callbackurl)
})

app.get('/monitor_video_processing', function(req, res) {
	var cmd = 'docker exec '+req.query.docker_name+' sh -c "cd /root/scripts/; python ./monitor_video_processing.py --video_id=\\"'+req.query.video_id+'\\" --callback_server=\\"'+req.query.callback_server+'\\" --callback_uri=\\"'+req.query.callback_uri+'\\" --maxRetries=\\"'+req.query.maxRetries+'\\" --secondsBetweenRetries=\\"'+req.query.secondsBetweenRetries+'\\""'
	shell.exec(cmd, function(code, stdout, stderr) { 
	})
	res.send('ok - the real result will be coming via callback from monitor_video_processing.py')
})

app.get('/start-docker', function(req, res) {
	shell.exec('docker start '+req.query.docker_name, function(code, stdout, stderr) {
	 	// I don't think we care about the return value.  The caller, which is google-cloud.js:startDocker()
		// will requery this vm again for more stuff
		res.send(stdout)
	})
})

app.get('/stop-docker', function(req, res) {
	shell.exec('docker stop '+req.query.docker_name, function(code, stdout, stderr) {
	 	// I don't think we care about the return value.  The caller, which is google-cloud.js:stopDocker()
		// will requery this vm again for more stuff
		res.send(stdout)
	})
})

// Recording is started in google-cloud.js:startRecording()
// app.get('/start-recording', function(req, res) {
// })

app.get('/stop-recording', function(req, res) {
	shell.exec('docker exec '+req.query.docker_name+' pkill -x call', function(code, stdout, stderr) {
		res.send(stdout)
	})
})

app.get('/stop-and-remove-docker', function(req, res) {
	var cmd = 'docker stop '+req.query.docker_name+';docker rm '+req.query.docker_name
	shell.exec(cmd, function(code, stdout, stderr) {
	 	// I don't think we care about the return value.  The caller, which is google-cloud.js:stopDocker()
		// will requery this vm again for more stuff
		res.send(stdout)
	})
})

app.get('/list-recordings', function(req, res) {
	var cmd = 'docker exec '+req.query.docker_name+' sh -c "ls -al /opt/vidyo/recordin*.*"'
	shell.exec(cmd, function(code, stdout, stderr) {
		res.send(stdout)	
	})
})

app.get('/remove-recording', function(req, res) {
	var cmd = 'docker exec '+req.query.docker_name+' rm '+req.query.filename+'; docker exec '+req.query.docker_name+' sh -c "ls -al /opt/vidyo/recording-*.*"'
	shell.exec(cmd, function(code, stdout, stderr) {
		res.send(stdout)
	})
})

var dockersAsJson = function(dockers) {
	return JSON.stringify(dockers)
}

var getDockers = function(stdout) {
		var lines = _.split(stdout, '\n')
		var data = []
		var attrs = ['name', 'status', 'port_mapping']
		_.each(lines, function(line) {
	    	var vals = _.split(line, '\t')
	    	var datum = {}
	    	for(var i=0; i < vals.length; i++) {
				datum[attrs[i]] = vals[i]	
	    	}
			if(datum['port_mapping'] && datum['port_mapping'].trim() != '')
				datum['port'] = datum['port_mapping'].substring('0.0.0.0:'.length, datum['port_mapping'].indexOf('->'))
			console.log('line: ', line)
			if(datum && datum['name'].startsWith('recorder')) {
	    		data.push(datum) // only get the 'recorder' containers, ignore my_mediabridge
			}
		})
        //console.log('data:', data) 
		return data 
}

var createAnotherDocker = function(res) {
	// NOTE the 'required_argument' - that's to keep you from running this script from the command line
    // but to allow this script to be called from here.  When you run that script from the command line,
	// the docker instance that's created DOES NOT get written to the firebase database.  That's a problem
    // because the app queries the /administration/dockers node to determine what dockers exist and what
	// state they're in.
	shell.exec('~/scripts/create-another-docker required_argument', function(code, stdout, stderr) { 
 	//	listDockers2(res)		
		res.send(stdout)
	})
}

var stopAndRemove = function(res) {
	shell.exec('~/scripts/stop-and-remove', function(code, stdout, stderr) {
		listDockers2(res)
	})
}

var listDockers2 = function(res) {
	shell.exec('~/scripts/dockers', function(code, stdout, stderr) {
    	var dockerListHtml = dockersAsHtml(getDockers(stdout))    
		var html = ''	
		html += '<html><head></head><body>'
		html += '<a href="/create-another-docker">Create Another Docker</a> &nbsp;&nbsp; <a href="/stop-and-remove">Stop/Remove Docker</a>'
		html += '<p/>'
		html += dockerListHtml 
		html += '</body>'
		html += '</html>'

        res.send(html)
    });
}

var dockersAsHtml = function(dockers) {

		var html = ''
		html += '<table border="1">'
        
		_.each(dockers, function(d) {
			html += '<tr>'
			html +=		'<td>'+d.name+'</td>'
			html +=		'<td>'+d.status+'</td>'
			html +=		'<td>'+d.port_mapping+'</td>'
			if(d.port)
				html += '<td>'+d.port+'</td>'
			else
				html +=	'<td> </td>'
			html += '</tr>'
		})
    	html += '</table>'
		return html
}

app.listen(7000, function() {
    console.log('app listeneing on port 7000')
})
