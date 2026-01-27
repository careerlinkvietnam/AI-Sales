#!/usr/bin/env npx ts-node
/**
 * Generate Scheduler Templates CLI
 *
 * Generates cron and systemd templates for automated operations.
 * Output: docs/ops/ directory
 *
 * Usage:
 *   npx ts-node src/cli/generate_scheduler_templates.ts [--output-dir <dir>]
 */

import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Templates
// =============================================================================

const CRON_DAILY_TEMPLATE = `# AI-Sales Daily Operations
# Schedule: Every day at 6:00 AM JST (21:00 UTC previous day)
#
# This cron job runs the daily operations preset which includes:
# - Reap stale queue jobs (recover stuck in_progress jobs)
# - Auto-stop failed jobs (disabled by default, enable in config)
# - Scan for errors
# - Process send queue
# - Generate daily report
# - Check data file status
#
# Prerequisites:
# - Node.js and npm installed
# - Project dependencies installed (npm install)
# - Environment variables configured in .env
#
# Installation:
#   crontab -e
#   # Add the following line (adjust path as needed):

# Dry-run (recommended for initial deployment)
0 6 * * * cd /path/to/AI-Sales && npx ts-node src/cli/run_ops.ts daily --json >> /var/log/ai_sales_daily.log 2>&1

# Execute mode (enable after confirming dry-run works)
# 0 6 * * * cd /path/to/AI-Sales && npx ts-node src/cli/run_ops.ts daily --execute --json >> /var/log/ai_sales_daily.log 2>&1

# With notification (requires SLACK_WEBHOOK_URL in .env)
# 0 6 * * * cd /path/to/AI-Sales && npx ts-node src/cli/run_ops.ts daily --execute --json 2>&1 | tee -a /var/log/ai_sales_daily.log
`;

const CRON_WEEKLY_TEMPLATE = `# AI-Sales Weekly Operations
# Schedule: Every Sunday at 7:00 AM JST (22:00 UTC Saturday)
#
# This cron job runs the weekly operations preset which includes:
# - Generate incidents report (errors from past 7 days)
# - Propose fixes for recurring issues
# - Compact data files (reduce NDJSON duplicates)
# - Generate weekly summary report
#
# Prerequisites:
# - Node.js and npm installed
# - Project dependencies installed (npm install)
# - Environment variables configured in .env
#
# Installation:
#   crontab -e
#   # Add the following line (adjust path as needed):

# Dry-run (recommended for initial deployment)
0 7 * * 0 cd /path/to/AI-Sales && npx ts-node src/cli/run_ops.ts weekly --json >> /var/log/ai_sales_weekly.log 2>&1

# Execute mode (enable after confirming dry-run works)
# 0 7 * * 0 cd /path/to/AI-Sales && npx ts-node src/cli/run_ops.ts weekly --execute --json >> /var/log/ai_sales_weekly.log 2>&1

# With notification (requires SLACK_WEBHOOK_URL in .env)
# 0 7 * * 0 cd /path/to/AI-Sales && npx ts-node src/cli/run_ops.ts weekly --execute --json 2>&1 | tee -a /var/log/ai_sales_weekly.log
`;

const SYSTEMD_DAILY_SERVICE_TEMPLATE = `[Unit]
Description=AI-Sales Daily Operations
After=network.target

[Service]
Type=oneshot
User=ai_sales
Group=ai_sales
WorkingDirectory=/opt/ai_sales
Environment=NODE_ENV=production
EnvironmentFile=/opt/ai_sales/.env

# Dry-run mode (default, recommended for initial deployment)
ExecStart=/usr/bin/npx ts-node src/cli/run_ops.ts daily --json

# Execute mode (uncomment after confirming dry-run works)
# ExecStart=/usr/bin/npx ts-node src/cli/run_ops.ts daily --execute --json

StandardOutput=append:/var/log/ai_sales/daily.log
StandardError=append:/var/log/ai_sales/daily.log

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/ai_sales/data /var/log/ai_sales

[Install]
WantedBy=multi-user.target
`;

const SYSTEMD_DAILY_TIMER_TEMPLATE = `[Unit]
Description=AI-Sales Daily Operations Timer
Requires=ai_sales_daily.service

[Timer]
# Run at 6:00 AM every day (local time)
OnCalendar=*-*-* 06:00:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
`;

const SYSTEMD_WEEKLY_SERVICE_TEMPLATE = `[Unit]
Description=AI-Sales Weekly Operations
After=network.target

[Service]
Type=oneshot
User=ai_sales
Group=ai_sales
WorkingDirectory=/opt/ai_sales
Environment=NODE_ENV=production
EnvironmentFile=/opt/ai_sales/.env

# Dry-run mode (default, recommended for initial deployment)
ExecStart=/usr/bin/npx ts-node src/cli/run_ops.ts weekly --json

# Execute mode (uncomment after confirming dry-run works)
# ExecStart=/usr/bin/npx ts-node src/cli/run_ops.ts weekly --execute --json

StandardOutput=append:/var/log/ai_sales/weekly.log
StandardError=append:/var/log/ai_sales/weekly.log

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/ai_sales/data /var/log/ai_sales

[Install]
WantedBy=multi-user.target
`;

const SYSTEMD_WEEKLY_TIMER_TEMPLATE = `[Unit]
Description=AI-Sales Weekly Operations Timer
Requires=ai_sales_weekly.service

[Timer]
# Run at 7:00 AM every Sunday (local time)
OnCalendar=Sun *-*-* 07:00:00
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
`;

const SYSTEMD_HEALTH_SERVICE_TEMPLATE = `[Unit]
Description=AI-Sales Health Check
After=network.target

[Service]
Type=oneshot
User=ai_sales
Group=ai_sales
WorkingDirectory=/opt/ai_sales
Environment=NODE_ENV=production
EnvironmentFile=/opt/ai_sales/.env

ExecStart=/usr/bin/npx ts-node src/cli/run_ops.ts health --json

StandardOutput=append:/var/log/ai_sales/health.log
StandardError=append:/var/log/ai_sales/health.log

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadOnlyPaths=/opt/ai_sales

[Install]
WantedBy=multi-user.target
`;

const SYSTEMD_HEALTH_TIMER_TEMPLATE = `[Unit]
Description=AI-Sales Health Check Timer
Requires=ai_sales_health.service

[Timer]
# Run every 4 hours
OnCalendar=*-*-* 00/4:00:00
Persistent=true

[Install]
WantedBy=timers.target
`;

const SYSTEMD_INSTALL_GUIDE = `# AI-Sales Systemd Installation Guide

## Prerequisites

1. Create dedicated user and group:
   \`\`\`bash
   sudo useradd -r -s /bin/false ai_sales
   sudo mkdir -p /opt/ai_sales
   sudo mkdir -p /var/log/ai_sales
   sudo chown -R ai_sales:ai_sales /opt/ai_sales /var/log/ai_sales
   \`\`\`

2. Deploy application to /opt/ai_sales:
   \`\`\`bash
   sudo cp -r /path/to/AI-Sales/* /opt/ai_sales/
   sudo chown -R ai_sales:ai_sales /opt/ai_sales
   cd /opt/ai_sales && sudo -u ai_sales npm install
   \`\`\`

3. Configure environment:
   \`\`\`bash
   sudo cp /opt/ai_sales/.env.example /opt/ai_sales/.env
   sudo chmod 600 /opt/ai_sales/.env
   sudo chown ai_sales:ai_sales /opt/ai_sales/.env
   # Edit .env with production values
   sudo nano /opt/ai_sales/.env
   \`\`\`

## Installation

1. Copy service and timer files:
   \`\`\`bash
   sudo cp ai_sales_daily.service /etc/systemd/system/
   sudo cp ai_sales_daily.timer /etc/systemd/system/
   sudo cp ai_sales_weekly.service /etc/systemd/system/
   sudo cp ai_sales_weekly.timer /etc/systemd/system/
   sudo cp ai_sales_health.service /etc/systemd/system/
   sudo cp ai_sales_health.timer /etc/systemd/system/
   \`\`\`

2. Reload systemd and enable timers:
   \`\`\`bash
   sudo systemctl daemon-reload
   sudo systemctl enable ai_sales_daily.timer
   sudo systemctl enable ai_sales_weekly.timer
   sudo systemctl enable ai_sales_health.timer
   sudo systemctl start ai_sales_daily.timer
   sudo systemctl start ai_sales_weekly.timer
   sudo systemctl start ai_sales_health.timer
   \`\`\`

## Verification

1. Check timer status:
   \`\`\`bash
   systemctl list-timers --all | grep ai_sales
   \`\`\`

2. Manual test run:
   \`\`\`bash
   sudo systemctl start ai_sales_daily.service
   sudo journalctl -u ai_sales_daily.service -f
   \`\`\`

3. Check logs:
   \`\`\`bash
   tail -f /var/log/ai_sales/daily.log
   tail -f /var/log/ai_sales/weekly.log
   tail -f /var/log/ai_sales/health.log
   \`\`\`

## Switching to Execute Mode

After confirming dry-run works correctly:

1. Edit the service file:
   \`\`\`bash
   sudo nano /etc/systemd/system/ai_sales_daily.service
   # Comment out dry-run ExecStart, uncomment execute ExecStart
   \`\`\`

2. Reload and restart:
   \`\`\`bash
   sudo systemctl daemon-reload
   sudo systemctl restart ai_sales_daily.timer
   \`\`\`

## Troubleshooting

- Check service status: \`systemctl status ai_sales_daily.service\`
- View recent logs: \`journalctl -u ai_sales_daily.service --since "1 hour ago"\`
- Test manually: \`sudo -u ai_sales /usr/bin/npx ts-node /opt/ai_sales/src/cli/run_ops.ts daily --json\`
`;

// =============================================================================
// CLI Implementation
// =============================================================================

interface GenerateResult {
  success: boolean;
  outputDir: string;
  filesGenerated: string[];
  errors: string[];
}

function generateSchedulerTemplates(outputDir: string): GenerateResult {
  const result: GenerateResult = {
    success: true,
    outputDir,
    filesGenerated: [],
    errors: [],
  };

  // Ensure output directories exist
  const systemdDir = path.join(outputDir, 'systemd');
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    if (!fs.existsSync(systemdDir)) {
      fs.mkdirSync(systemdDir, { recursive: true });
    }
  } catch (err) {
    result.success = false;
    result.errors.push(`Failed to create output directories: ${err}`);
    return result;
  }

  // Define files to generate
  const files: Array<{ path: string; content: string }> = [
    // Cron templates
    { path: path.join(outputDir, 'cron_daily.txt'), content: CRON_DAILY_TEMPLATE },
    { path: path.join(outputDir, 'cron_weekly.txt'), content: CRON_WEEKLY_TEMPLATE },
    // Systemd templates
    { path: path.join(systemdDir, 'ai_sales_daily.service'), content: SYSTEMD_DAILY_SERVICE_TEMPLATE },
    { path: path.join(systemdDir, 'ai_sales_daily.timer'), content: SYSTEMD_DAILY_TIMER_TEMPLATE },
    { path: path.join(systemdDir, 'ai_sales_weekly.service'), content: SYSTEMD_WEEKLY_SERVICE_TEMPLATE },
    { path: path.join(systemdDir, 'ai_sales_weekly.timer'), content: SYSTEMD_WEEKLY_TIMER_TEMPLATE },
    { path: path.join(systemdDir, 'ai_sales_health.service'), content: SYSTEMD_HEALTH_SERVICE_TEMPLATE },
    { path: path.join(systemdDir, 'ai_sales_health.timer'), content: SYSTEMD_HEALTH_TIMER_TEMPLATE },
    { path: path.join(systemdDir, 'INSTALL.md'), content: SYSTEMD_INSTALL_GUIDE },
  ];

  // Generate each file
  for (const file of files) {
    try {
      fs.writeFileSync(file.path, file.content, 'utf-8');
      result.filesGenerated.push(path.relative(outputDir, file.path));
    } catch (err) {
      result.success = false;
      result.errors.push(`Failed to write ${file.path}: ${err}`);
    }
  }

  return result;
}

function printUsage(): void {
  console.log(`
Usage: npx ts-node src/cli/generate_scheduler_templates.ts [options]

Options:
  --output-dir <dir>  Output directory (default: docs/ops)
  --json              Output result as JSON
  --help              Show this help message

Examples:
  npx ts-node src/cli/generate_scheduler_templates.ts
  npx ts-node src/cli/generate_scheduler_templates.ts --output-dir /tmp/ops
  npx ts-node src/cli/generate_scheduler_templates.ts --json
`);
}

function main(): void {
  const args = process.argv.slice(2);

  // Parse arguments
  let outputDir = path.join(process.cwd(), 'docs', 'ops');
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg === '--output-dir' && args[i + 1]) {
      outputDir = args[++i];
    } else if (arg === '--json') {
      jsonOutput = true;
    }
  }

  // Generate templates
  const result = generateSchedulerTemplates(outputDir);

  // Output result
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.success) {
      console.log(`\n✓ Scheduler templates generated successfully`);
      console.log(`  Output directory: ${result.outputDir}`);
      console.log(`\n  Files generated:`);
      for (const file of result.filesGenerated) {
        console.log(`    - ${file}`);
      }
      console.log(`\n  Next steps:`);
      console.log(`    1. Review generated templates`);
      console.log(`    2. Adjust paths in templates to match your deployment`);
      console.log(`    3. For cron: crontab -e and add entries from cron_*.txt`);
      console.log(`    4. For systemd: Follow docs/ops/systemd/INSTALL.md`);
    } else {
      console.error(`\n✗ Failed to generate some templates`);
      for (const error of result.errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }
  }
}

// Export for testing
export { generateSchedulerTemplates, GenerateResult };

// Run CLI
main();
