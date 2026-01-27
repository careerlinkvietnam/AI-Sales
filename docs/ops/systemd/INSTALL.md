# AI-Sales Systemd Installation Guide

## Prerequisites

1. Create dedicated user and group:
   ```bash
   sudo useradd -r -s /bin/false ai_sales
   sudo mkdir -p /opt/ai_sales
   sudo mkdir -p /var/log/ai_sales
   sudo chown -R ai_sales:ai_sales /opt/ai_sales /var/log/ai_sales
   ```

2. Deploy application to /opt/ai_sales:
   ```bash
   sudo cp -r /path/to/AI-Sales/* /opt/ai_sales/
   sudo chown -R ai_sales:ai_sales /opt/ai_sales
   cd /opt/ai_sales && sudo -u ai_sales npm install
   ```

3. Configure environment:
   ```bash
   sudo cp /opt/ai_sales/.env.example /opt/ai_sales/.env
   sudo chmod 600 /opt/ai_sales/.env
   sudo chown ai_sales:ai_sales /opt/ai_sales/.env
   # Edit .env with production values
   sudo nano /opt/ai_sales/.env
   ```

## Installation

1. Copy service and timer files:
   ```bash
   sudo cp ai_sales_daily.service /etc/systemd/system/
   sudo cp ai_sales_daily.timer /etc/systemd/system/
   sudo cp ai_sales_weekly.service /etc/systemd/system/
   sudo cp ai_sales_weekly.timer /etc/systemd/system/
   sudo cp ai_sales_health.service /etc/systemd/system/
   sudo cp ai_sales_health.timer /etc/systemd/system/
   ```

2. Reload systemd and enable timers:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable ai_sales_daily.timer
   sudo systemctl enable ai_sales_weekly.timer
   sudo systemctl enable ai_sales_health.timer
   sudo systemctl start ai_sales_daily.timer
   sudo systemctl start ai_sales_weekly.timer
   sudo systemctl start ai_sales_health.timer
   ```

## Verification

1. Check timer status:
   ```bash
   systemctl list-timers --all | grep ai_sales
   ```

2. Manual test run:
   ```bash
   sudo systemctl start ai_sales_daily.service
   sudo journalctl -u ai_sales_daily.service -f
   ```

3. Check logs:
   ```bash
   tail -f /var/log/ai_sales/daily.log
   tail -f /var/log/ai_sales/weekly.log
   tail -f /var/log/ai_sales/health.log
   ```

## Switching to Execute Mode

After confirming dry-run works correctly:

1. Edit the service file:
   ```bash
   sudo nano /etc/systemd/system/ai_sales_daily.service
   # Comment out dry-run ExecStart, uncomment execute ExecStart
   ```

2. Reload and restart:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ai_sales_daily.timer
   ```

## Troubleshooting

- Check service status: `systemctl status ai_sales_daily.service`
- View recent logs: `journalctl -u ai_sales_daily.service --since "1 hour ago"`
- Test manually: `sudo -u ai_sales /usr/bin/npx ts-node /opt/ai_sales/src/cli/run_ops.ts daily --json`
