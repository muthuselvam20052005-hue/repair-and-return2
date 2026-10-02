# Repair & Return: customer app + organization website

One small server runs both. Customers place orders in the app, and the organization sees them on the website within a second, on any device.

## Run it (2 minutes)
1. Install Node.js (the LTS version) from https://nodejs.org if you don't have it.
2. Unzip this folder. Windows: double-click **start.bat**. Mac/Linux: open a terminal in the folder and run `node server.js`.
3. The window prints your links:
   - Customer app: http://localhost:3000/
   - Organization website: http://localhost:3000/org  (password: **repair123**)
   - Phone on the same Wi-Fi: the `http://192.168.x.x:3000/` link it prints

## Demo flow
1. On the phone (or one browser tab), open the customer app, log in with a name and a 10-digit mobile number, and tap Start a repair.
2. On the laptop, open the organization website and sign in. The order appears with the customer's name, mobile number, address, problem and photo.
3. Assign a pickup person, then continue through the stages. The customer's Track screen updates by itself.

## Change the password
Windows (Command Prompt): `set ORG_PASSWORD=mypassword && node server.js`
Mac/Linux: `ORG_PASSWORD=mypassword node server.js`

## Put it online (so it works from anywhere)
Upload this folder to GitHub and create a free Web Service on https://render.com (Start command: `node server.js`, add an environment variable ORG_PASSWORD). Render gives you one public link: `/` is the customer app and `/org` is the organization website. Note: the free plan can wipe saved orders when the service restarts.

## Notes
- Orders are saved in `data.json` next to the server and survive restarts when run on your own computer.
- Customer login is name plus mobile number only (no OTP), so treat it as a demo login.
