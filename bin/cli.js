#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
Port Manager — Manage WSL & Windows ports

Usage:
  port-manager [command]

Commands:
  open        Launch the GUI (default)
  list        List listening ports (CLI)
  help        Show this help message

Options:
  --version   Show version number
  --help      Show help
`);
}

function printVersion() {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  console.log(`Port-Manager v${pkg.version}`);
}

async function listPorts() {
  const { scanPorts } = require(path.join(__dirname, '..', 'main', 'scanner'));
  const { ports, errors } = await scanPorts();

  if (errors.length > 0) {
    errors.forEach(e => console.error(`⚠ ${e.source}: ${e.message}`));
  }

  if (ports.length === 0) {
    console.log('No listening ports found.');
    return;
  }

  const header = 'PORT\tPROTO\tADDRESS\t\tSTATE\tPID\tPROCESS\tSOURCE';
  console.log(header);
  console.log('-'.repeat(70));

  ports
    .sort((a, b) => a.port - b.port)
    .forEach(p => {
      const pid = p.pid !== null ? p.pid : '—';
      const proc = p.processName || '<unknown>';
      console.log(`${p.port}\t${p.protocol}\t${p.localAddress}\t${p.state}\t${pid}\t${proc}\t${p.source}`);
    });

  console.log(`\nTotal: ${ports.length} ports`);
}

function openGUI() {
  const electronPath = path.join(__dirname, '..', 'node_modules', '.bin', 'electron');
  const appPath = path.join(__dirname, '..');
  const child = spawn(electronPath, [appPath], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  console.log('Port Manager launched.');
}

const command = args[0] || 'open';

switch (command) {
  case 'open':
    openGUI();
    break;
  case 'list':
    listPorts().catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'help':
  case '--help':
    printHelp();
    break;
  case '--version':
    printVersion();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
