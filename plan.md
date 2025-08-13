```markdown
# Detailed Implementation Plan for ERP/POS System – M-Pesa Integration (SQLite)

This plan describes the step-by-step changes required to support SQLite for the database and add an M-Pesa module that lets business users configure their own M-Pesa credentials. The integration includes backend endpoints for STK Push initiation and configuration management, as well as a new UI settings page.

---

## 1. Backend Implementation

### 1.1. Update Dependencies and Database Configuration

**File:** server/package.json  
- **Changes:**
  - Add the SQLite dependency, for example:
    ```json
    "dependencies": {
      "sqlite3": "^5.1.2",
      // ...other dependencies
    }
    ```
  - Ensure scripts (if any) that run migrations or start the server work with SQLite.

**File:** server/config/database.js  
- **Changes:**
  - Update the connection logic to use SQLite instead of MySQL.
  - Example:
    ```javascript
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const dbPath = path.join(__dirname, '../../database.sqlite');

    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error(`Database connection error: ${err.message}`);
      } else {
        console.log('Connected to SQLite database.');
      }
    });

    module.exports = db;
    ```
  - Add error handling to log and handle connection issues.

### 1.2. Migration Updates for SQLite Compatibility

**File:** server/migrations/010_create_system_settings_table.sql  
- **Changes:**
  - Ensure the table can store M-Pesa credentials:
    ```sql
    CREATE TABLE system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vat DECIMAL(4,2) DEFAULT 16.00,
      mpesa_consumer_key TEXT,
      mpesa_consumer_secret TEXT,
      mpesa_business_short_code TEXT,
      mpesa_passkey TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    ```
  - Review other migration files for SQLite-syntax adjustments (e.g., using INTEGER PRIMARY KEY AUTOINCREMENT).

**File:** server/scripts/migrate.js  
- **Changes:**
  - Verify that the migration script reads SQL files correctly and executes them using the SQLite database connection.
  - Add try-catch blocks and log errors for each migration execution.

### 1.3. M-Pesa Module Controller

**File:** server/controllers/mpesaController.js  
- **New/Updated Functions:**
  - **updateMpesaConfig(req, res):**
    - Validate incoming credentials (consumer key, secret, business short code, passkey).
    - Update or insert values into the `system_settings` table.
    - Return a success message with HTTP 200 or error with proper status code.
  - **initiateSTKPush(req, res):**
    - Retrieve stored M-Pesa credentials from `system_settings`.
    - Validate that credentials exist; if missing, return an error message.
    - Accept transaction details from the request body.
    - Simulate an M-Pesa STK Push request (or call a sandbox endpoint) using the retrieved credentials.
    - Wrap the process in try-catch and return proper HTTP responses.
  - **handleCallback(req, res):**
    - Process M-Pesa asynchronous callback data.
    - Use try-catch for error handling and log any issues.
- **Error Handling:**
  - Use try-catch blocks for each function.
  - Return descriptive error messages and HTTP status codes (e.g., 400 for bad requests, 500 for server errors).

### 1.4. M-Pesa API Routes

**File:** server/routes/mpesa.js  
- **Changes:**
  - Add the following endpoints:
    - `POST /api/mpesa/config` → Calls `mpesaController.updateMpesaConfig`
    - `POST /api/mpesa/initiate` → Calls `mpesaController.initiateSTKPush`
    - `POST /api/mpesa/callback` → Calls `mpesaController.handleCallback`
  - Ensure proper middleware is in place (e.g., authentication middleware if needed).

### 1.5. Error Handling Middleware

**File:** server/middleware/errorHandler.js  
- **Changes:**
  - Ensure that the middleware catches errors from the new M-Pesa endpoints.
  - Log error details and send a generic error message to the client.

---

## 2. Frontend Implementation

### 2.1. Update Layout Navigation

**File:** src/app/layout.tsx  
- **Changes:**
  - Add a new navigation link “Settings” to allow access to the M-Pesa configuration page.
  - Use the Next.js `Link` component and style it to match existing header elements.
  - Example snippet:
    ```tsx
    import Link from 'next/link';
    // Inside header navigation section:
    <nav className="flex space-x-4">
      <Link href="/"><a className="text-gray-700 hover:text-gray-900">Home</a></Link>
      <Link href="/settings/mpesa"><a className="text-gray-700 hover:text-gray-900">Settings</a></Link>
    </nav>
    ```

### 2.2. Create M-Pesa Settings Page

**File:** src/app/settings/mpesa.tsx  
- **Changes:**
  - Create a new page for M-Pesa configuration.
  - Use shadcn/ui components (`<Card>`, `<Input>`, `<Label>`, and `<Button>`) and Tailwind CSS for a clean, modern interface.
  - UI features:
    - Page title: “M-Pesa Configuration”
    - Form fields for:
      - Consumer Key
      - Consumer Secret
      - Business Short Code
      - Passkey
    - Include clear labels and placeholders.
    - Display loading state and error/success messages using `toast`.
  - Example component structure:
    ```tsx
    'use client';
    import { useState } from 'react';
    import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
    import { Button } from '@/components/ui/button';
    import { Input } from '@/components/ui/input';
    import { Label } from '@/components/ui/label';
    import { toast } from 'sonner';
    
    export default function MpesaSettings() {
      const [config, setConfig] = useState({
        consumer_key: '',
        consumer_secret: '',
        business_short_code: '',
        passkey: ''
      });
      const [loading, setLoading] = useState(false);
    
      const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
          const response = await fetch('/api/mpesa/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
          });
          const data = await response.json();
          if (response.ok) {
            toast.success('M-Pesa settings updated successfully!');
          } else {
            toast.error(data.message || 'Update failed');
          }
        } catch (error) {
          toast.error('Network error. Please try again.');
        } finally {
          setLoading(false);
        }
      };
    
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-md">
            <CardHeader>
              <CardTitle>M-Pesa Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="consumer_key">Consumer Key</Label>
                  <Input id="consumer_key" type="text" placeholder="Enter Consumer Key" required
                    value={config.consumer_key}
                    onChange={(e) => setConfig({ ...config, consumer_key: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="consumer_secret">Consumer Secret</Label>
                  <Input id="consumer_secret" type="text" placeholder="Enter Consumer Secret" required
                    value={config.consumer_secret}
                    onChange={(e) => setConfig({ ...config, consumer_secret: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="business_short_code">Business Short Code</Label>
                  <Input id="business_short_code" type="text" placeholder="Enter Business Short Code" required
                    value={config.business_short_code}
                    onChange={(e) => setConfig({ ...config, business_short_code: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="passkey">Passkey</Label>
                  <Input id="passkey" type="text" placeholder="Enter Passkey" required
                    value={config.passkey}
                    onChange={(e) => setConfig({ ...config, passkey: e.target.value })}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Saving...' : 'Update Settings'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      );
    }
    ```
  - Ensure responsiveness and modern spacing with Tailwind CSS classes.

---

## 3. Testing & API Validation

- **Curl Testing:**
  - Test M-Pesa config endpoint:
    ```bash
    curl -X POST http://localhost:3000/api/mpesa/config \
      -H "Content-Type: application/json" \
      -d '{"consumer_key": "demoKey", "consumer_secret": "demoSecret", "business_short_code": "123456", "passkey": "demoPasskey"}'
    ```
  - Test STK Push initiation:
    ```bash
    curl -X POST http://localhost:3000/api/mpesa/initiate \
      -H "Content-Type: application/json" \
      -d '{"amount": 100, "phone": "+254700000000", "accountReference": "POS001", "transactionDesc": "Test Transaction"}'
    ```
  - Verify HTTP response codes, response bodies, and error messages.

- **UI Testing:**
  - Validate that the settings page displays correctly across devices.
  - Confirm that updates trigger toast notifications and appropriate success/error messages.

---

## 4. Error Handling & Best Practices

- All backend controller functions are wrapped in try-catch blocks and return appropriate HTTP status and messages.
- Input validations are performed both on the frontend (required fields) and backend.
- Logging is added to catch and record unforeseen errors.
- Secure endpoints by applying JWT middleware if required in future stages.
- Use consistent response formats for easier debugging and API integration.

---

## Summary
- Updated the backend package to use SQLite and modified database configuration accordingly.  
- Adjusted migration files (e.g., system_settings) for SQLite compatibility and included fields for M-Pesa credentials.  
- Refactored the mpesaController and corresponding routes (mpesa.js) to handle configuration, STK Push initiation, and callbacks with robust error handling.  
- Added a new frontend settings page (src/app/settings/mpesa.tsx) with a modern, responsive design using Tailwind CSS and shadcn/ui components.  
- Introduced navigation changes in layout.tsx to access settings, and provided comprehensive curl commands for API testing.  
- Ensured consistent error handling and input validation for a reliable, production-level ERP/POS system.
