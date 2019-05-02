/**
 * requirements
 */
const process = require('process');
const net     = require('net');
const util    = require('util');
const path    = require('path');
const getopts = require('getopts');

// or if we have getopts.js at local directory, we can import it directly
//const getopts = require('./getopts');

(function TcpProxyServer(){
    /**
     * handle exception
     */
    process.on("uncaughtException", function(error) {
        console.error(error);
    });
    /**
     * handle commandline options
     */
    let optVal = 0;
    const prog = path.basename(process.argv[1]);
    function usage() {
        console.log('\r\nUsage:\r\n');
        console.log('\t%s [-D|--duplex] -r|--remote_server <remote address> -p|--remote_port <remote port> \\', prog);
        console.log('\t\t[-l|--local_server <local address>] [-o|--local_port <local port>] \\');
        console.log('\t\t[-m|--duplex_host <address of dedicated host for duplex comm.>] [-x|--max_clients <#number>] \\');
        console.log('\t\t[-G|--get_conf');
        console.log('\tWhere the mandatory arguments are:\r\n');
        console.log('\t\t-r|--remote_server - the remote host where the proxy server connects');
        console.log('\t\t-p|--remote_port   - the remote service which is used by proxy server during connection\r\n');
        console.log('\tthe optional arguments are:\r\n');
        console.log('\t\t-D|--duplex        - allows dedicated host to communicate the remote server in duplex mode. Default is false.');
        console.log('\t\t-l|--local_server  - the server listening address where clients can connect. Default is 0.0.0.0');
        console.log('\t\t-o|--local_port    - the server listening service which is transfered to remote server service port. Default is 8739');
        console.log('\t\t-m|--duplex_host   - the address of dedicated client address, in duplex mode two way communication allowed for this host');
        console.log('\t\t-G|--get_conf      - lists default configuration options.');
        console.log('\t\t-x|--max_clients   - maximum number of clients allowed to connect to the proxy server. Default is 32\r\n\r\n');
        process.exit(0);
    }
    const options = getopts(process.argv.slice(2), {
        alias: {
            G: 'get_conf',      // prints out our default - wired in - configuration
            h: 'help',          // this help
            D: 'duplex',        // flag for sign duplexity
            m: 'duplex_host',   // address of the dedicated host, which - if duplex mode enabled - can communicated R/W with remote server
            l: 'local_server',  // our server's address
            o: 'local_port',    // our server's listening port
            r: 'remote_server', // address of the remote server
            p: 'remote_port',   // the remote service on the server
            x: 'max_clients'    // maximum number of clients to connect
        },
        default: {
            D: false,           // by default duplex mode is not available
            m: '10.2.139.11',   // this is the dedicated host, which in turn can communicate R/W with the remote server
            l: '0.0.0.0',       // we accept IPv4 connection requests
            o: 50000,           // listening port for R/O and|or R/W clients
            x: 16
        }
    });
    if (options['help']) {
        usage();
    }
    if (options['get_conf']) {
        console.log('Default configuration:');
        for (let item in options) {
            switch(item) {
                case 'duplex_host':
                    console.log('\t%s:\t%s',item, options[item]);
                break;
                case 'local_address':
                    console.log('\t%s:\t%s',item, options[item]);
                break;
                case 'local_port':
                    console.log('\t%s:\t%s',item, options[item]);
                break;
                case 'max_clients':
                    console.log('\t%s:\t%s',item, options[item]);
                break;
            }
        }
        process.exit(0);
    }
    if (options['remote_server']) {
        optVal |= 1;
    }
    if (options['remote_port']) {
        optVal |= 2;
    }
    if (optVal !== 3) {
        switch(optVal) {
            case 0:
                console.error('\r\nError: missing remote host and port from arguments!');
                usage();
            break;
            case 1:
                console.error('\r\nError: missing remote port from arguments!');
                usage();
            break;
            case 2:
                console.error('\r\nError: missing remote host from arguments!');
                usage();
            break;
        }
    } else {
    /**
     * constants after processing command line arguments
     */
    const localaddress = options['local_server'];
    const localport    = options['local_port'];
    const remotehost   = options['remote_server'];
    const remoteport   = options['remote_port'];
    /**
     * define or maximum number of client to be served - including the R/W client as well
     */
    const max_clients = options['max_clients'];
    /**
     * storage of active clients
     */
    let clients = {};
    /**
     * number of active clients
     */
    let clientCount = 0;
    /**
     * the connection to the remote server
     */
    const remote_connection = new net.Socket();
    remote_connection.connect(remoteport, remotehost);
    const server = net.createServer();
    remote_connection.on('ready', () => {
        console.log("Server is ready!");
    });
    remote_connection.on('close', () => {
        console.log('Remote server disconnected, we close all active connections too!');
        for (let client in clients){
            clients[client].close();
        }
    });
    remote_connection.on('data', data => {
        let flushed;
        for (let client in clients) {
            flushed = clients[client].write(data);
            if (!flushed) {
                remote_connection.pause();
            } else {
                console.log('We broadcasted data to %s:%d',clients[client].remoteAddress, clients[client].remotePort);
            }
        }
    });
    remote_connection.on('drain', () => {
        remote_connection.resume();
    });
    /**
     * set up our listening TCP server
     */
    server.on('connection', connection =>  {
        let clientname = connection.remoteAddress+'_'+connection.remotePort;
        if (clientCount < max_clients) {
            clientCount++;
            clients[clientname] = connection;
            console.log('register %s [%d]', clientname, clientCount);
        } else {
            console.log('Maximum number of clients reached!');
            connection.end();
        }
        connection.on('close', () => {
            if (clients[clientname]) {
                clientCount--;
            }
            delete clients[clientname];
            console.log('remove %s [%d]', clientname, clientCount);
        });
        connection.on('data', (data) => {
            if (connection.remoteAddress === options['duplex_host'] && options['duplex']) {
                let flushed = remote_connection.write(data);
                if (!flushed) {
                    server.pause();
                } else {
                    console.log('we got data from client (%s:%d)\r\n, and write data to remote server (%s:%d): %s',
                        connection.remoteAddress,
                        connection.remotePort,
                        remote_connection.remoteAddress,
                        remote_connection.remotePort,
                        data.toString('utf8')
                    );
                }
            } else {
                console.warn('You are not allowed to write data back to server\r\nData: %s', data.toString('utf8'));
            }
        });
        connection.on('drain', () => {
            server.resume();
        });
    });
    server.listen(localport, localaddress);
    console.log("redirecting connections from %s:%d to %s:%d", localaddress, localport, remotehost, remoteport);
    }
}());

