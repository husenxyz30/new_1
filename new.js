const axios = require('axios');
const Web3 = require('web3');
const chalk = require('chalk');
const Table = require('cli-table3');
const { promisify } = require('util');
const sleep = promisify(setTimeout);

// Setup logging
const logger = {
    info: (msg) => console.log(chalk.blue(msg)),
    error: (msg) => console.error(chalk.red(msg)),
    warning: (msg) => console.warn(chalk.yellow(msg)),
};

// Banner
function printBanner() {
    console.log(chalk.cyan('╔════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan('║                 OYACHAT AUTO BOT                   ║'));
    console.log(chalk.cyan('║         Automate your Oyachat registration!        ║'));
    console.log(chalk.cyan('║    Developed by: husenxyz30    ║'));
    console.log(chalk.cyan('║    GitHub: https://github.com/husenxyz30            ║'));
    console.log(chalk.cyan('╠════════════════════════════════════════════════════╣'));
}

// Fungsi untuk membuat daftar alamat wallet acak
function generateWallets(count) {
    const web3 = new Web3();
    const wallets = [];
    for (let i = 0; i < count; i++) {
        const account = web3.eth.accounts.create();
        wallets.push(account.address);
    }
    return wallets;
}

// Fungsi untuk mendapatkan email sementara dari Guerrilla Mail
async function getTempEmailGuerrilla() {
    const url = "https://api.guerrillamail.com/ajax.php?f=get_email_address";
    const response = await axios.get(url);
    const data = response.data;
    const email = data.email_addr;
    const sid_token = data.sid_token;
    logger.info(`Generated Guerrilla Email: ${email}`);
    return { email, sid_token };
}

// Fungsi untuk mendapatkan domain yang tersedia dari mail.tm
async function getMailtmDomains() {
    const url = "https://api.mail.tm/domains";
    const response = await axios.get(url);
    if (response.status === 200) {
        const domains = response.data['hydra:member'];
        return domains[0]['domain'];
    }
    logger.error(`Failed to fetch mail.tm domains: ${response.status} - ${response.statusText}`);
    return "xxnm.me";
}

// Fungsi untuk mendapatkan email sementara dari mail.tm dengan retry
async function getTempEmailMailtm() {
    const domain = await getMailtmDomains();
    const url = "https://api.mail.tm/accounts";
    const headers = { "Content-Type": "application/json" };
    const email_address = `${Math.random().toString(36).substring(2, 12)}@${domain}`;
    const payload = { address: email_address, password: "temporarypassword123" };

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await axios.post(url, payload, { headers });
            if (response.status === 201) {
                const data = response.data;
                const email = data.address;
                const tokenResponse = await axios.post("https://api.mail.tm/token", payload, { headers });
                if (tokenResponse.status === 200) {
                    const token = tokenResponse.data.token;
                    logger.info(`Generated mail.tm Email: ${email}`);
                    return { email, token };
                } else {
                    logger.error(`Failed to get mail.tm token: ${tokenResponse.status} - ${tokenResponse.statusText}`);
                }
            }
        } catch (error) {
            if (error.response && error.response.status === 429) {
                logger.warning(`Rate limit hit (429), retrying in ${Math.pow(2, attempt)} seconds...`);
                await sleep(Math.pow(2, attempt) * 1000);
                continue;
            } else {
                logger.error(`Failed to create mail.tm email: ${error.response.status} - ${error.response.statusText}`);
            }
        }
        await sleep(1000);
    }
    logger.error("Failed to create mail.tm email after retries");
    return { email: null, token: null };
}

// Fungsi untuk memilih provider email
async function getTempEmail(providerChoice) {
    if (providerChoice === "1") {
        return await getTempEmailGuerrilla();
    } else if (providerChoice === "2") {
        return await getTempEmailMailtm();
    } else {
        logger.error("Invalid email provider selected");
        return { email: null, token: null };
    }
}

// Fungsi untuk mendapatkan OTP dari Guerrilla Mail
async function getOtpGuerrilla(email, sid_token) {
    const url = `https://api.guerrillamail.com/ajax.php?f=check_email&seq=1&sid_token=${sid_token}`;
    for (let i = 0; i < 24; i++) {
        const response = await axios.get(url);
        if (response.status === 200) {
            const data = response.data;
            const messages = data.list || [];
            if (messages.length > 0) {
                const latestMessage = messages[0];
                const mail_id = latestMessage.mail_id;
                const fetchUrl = `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${mail_id}&sid_token=${sid_token}`;
                const mailResponse = await axios.get(fetchUrl);
                if (mailResponse.status === 200) {
                    const mailData = mailResponse.data;
                    const mailText = mailData.mail_body || '';
                    const otp = mailText.split(' ').find(word => /^\d{6}$/.test(word));
                    if (otp) {
                        logger.info(`OTP Found: ${otp}`);
                        return otp;
                    }
                }
            }
        }
        logger.info("Waiting for OTP... (5 seconds)");
        await sleep(5000);
    }
    logger.error("OTP not found within 120 seconds");
    return null;
}

// Fungsi untuk mendapatkan OTP dari mail.tm
async function getOtpMailtm(email, token) {
    const url = "https://api.mail.tm/messages";
    const headers = { "Authorization": `Bearer ${token}` };
    for (let i = 0; i < 24; i++) {
        const response = await axios.get(url, { headers });
        if (response.status === 200) {
            const data = response.data;
            if (data['hydra:member'].length > 0) {
                const latestMessage = data['hydra:member'][0];
                const msgUrl = `https://api.mail.tm/messages/${latestMessage.id}`;
                const msgResponse = await axios.get(msgUrl, { headers });
                if (msgResponse.status === 200) {
                    const mailData = msgResponse.data;
                    const mailText = mailData.text || '';
                    const otp = mailText.split(' ').find(word => /^\d{6}$/.test(word));
                    if (otp) {
                        logger.info(`OTP Found: ${otp}`);
                        return otp;
                    }
                }
            }
        } else if (response.status === 429) {
            logger.warning("Rate limit hit (429) while fetching OTP, waiting 5 seconds...");
            await sleep(5000);
            continue;
        }
        logger.info("Waiting for OTP... (5 seconds)");
        await sleep(5000);
    }
    logger.error("OTP not found within 120 seconds");
    return null;
}

// Fungsi untuk mendapatkan OTP berdasarkan provider
async function getOtp(email, token, providerChoice) {
    if (providerChoice === "1") {
        return await getOtpGuerrilla(email, token);
    } else if (providerChoice === "2") {
        return await getOtpMailtm(email, token);
    }
    return null;
}

// Langkah 1: Inisialisasi Passwordless
async function initPasswordless(email) {
    const url = "https://auth.privy.io/api/v1/passwordless/init";
    const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "privy-app-id": "clxjfwh3d005bcewwp6vvtfm6",
        "privy-ca-id": "05809be7-08a0-421a-9bf2-48032805e9e5",
        "User -Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://oyachat.com",
        "Referer": "https://oyachat.com/"
    };
    const payload = { email };
    
    const response = await axios.post(url, payload, { headers });
    logger.info(`Init Passwordless Status: ${response.status}`);
    return response.status === 200;
}

// Langkah 2: Verifikasi OTP
async function verifyOtp(email, otp) {
    const url = "https://auth.privy.io/api/v1/passwordless/authenticate";
    const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "privy-app-id": "clxjfwh3d005bcewwp6vvtfm6",
        "privy-ca-id": "05809be7-08a0-421a-9bf2-48032805e9e5",
        "User -Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://oyachat.com",
        "Referer": "https://oyachat.com/"
    };
    const payload = { email, code: otp };
    
    const response = await axios.post(url, payload, { headers });
    logger.info(`Verify OTP Status: ${response.status}`);
    const privy_token = response.data.token;
    const user_id = response.data.user?.id;
    return response.status === 200 ? { success: true, privy_token, user_id } : { success: false };
}

// Langkah 3: Registrasi/Login ke Oyachat
async function registerOyachat(email, privy_token, user_id, wallet_address, referral_code) {
    const url = "https://oyachat.com/api/wallet/login";
    const headers = {
        "Content-Type": "application/json",
        "Accept": "*/*",
        "User -Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://oyachat.com",
        "Referer": `https://oyachat.com/?referral_code=${referral_code}`,
        "Cookie": `privy-token=${privy_token}`
    };
    const payload = {
        email,
        address: wallet_address,
        referral_code,
        user: {
            id: user_id,
            createdAt: new Date().toISOString(),
        }
    };
    
    const response = await axios.post(url, payload, { headers });
    logger.info(`Registration Status for ${wallet_address}: ${response.status}`);
    return response.status === 201;
}

// Proses registrasi untuk satu wallet
async function processWallet(wallet, referral_code, provider_choice) {
    console.log(chalk.cyan(`\n${'='.repeat(50)}`));
    logger.info(`Processing Wallet: ${wallet}`);
    const { email, token } = await getTempEmail(provider_choice);
    if (email && token && await initPasswordless(email)) {
        const otp = await getOtp(email, token, provider_choice);
        if (otp) {
            const { success, privy_token, user_id } = await verifyOtp(email, otp);
            if (success) {
                if (await registerOyachat(email, privy_token, user_id, wallet, referral_code)) {
                    logger.info(`Wallet ${wallet} registered successfully!`);
                    return true;
                } else {
                    logger.error(`Registration failed for wallet ${wallet}`);
                }
            } else {
                logger.error(`OTP verification failed for wallet ${wallet}`);
            }
        } else {
            logger.error(`Failed to retrieve OTP for wallet ${wallet}`);
        }
    } else {
        logger.error(`Failed to initiate process for wallet ${wallet}`);
    }
    return false;
}

// Eksekusi berurutan dengan ringkasan tabel
(async () => {
    printBanner();
    
    const referral_code = prompt("Enter your referral code: ").trim();
    if (!referral_code) {
        logger.error("Referral code cannot be empty");
        process.exit();
    }

    let num_wallets;
    try {
        num_wallets = parseInt(prompt("Enter the number of wallets to generate: "));
        if (num_wallets <= 0) {
            throw new Error("Number must be greater than 0.");
        }
    } catch (e) {
        logger.error(`Invalid input: ${e.message}. Please enter a positive number`);
        process.exit();
    }

    console.log("Choose email provider:");
    console.log("1. Guerrilla Mail");
    console.log("2. mail.tm");
    const provider_choice = prompt("Enter your choice (1 or 2): ").trim();
    if (!["1", "2"].includes(provider_choice)) {
        logger.error("Invalid choice. Please enter 1 or 2");
        process.exit();
    }

    logger.info(`Generating ${num_wallets} wallets...`);
    const wallets = generateWallets(num_wallets);
    logger.info(`Successfully generated ${num_wallets} wallets`);

    // Menyimpan hasil untuk ringkasan
    const results = [];

    // Proses setiap wallet
    for (let i = 0; i < wallets.length; i++) {
        const wallet = wallets[i];
        logger.info(`Processing wallet ${i + 1}/${num_wallets}`);
        const success = await processWallet(wallet, referral_code, provider_choice);
        results.push([wallet, success ? "Success" : "Failed"]);
    }

    // Tampilkan ringkasan dalam tabel
    console.log(chalk.cyan(`\n${'='.repeat(50)}`));
    const table = new Table({
        head: ['Wallet Address', 'Status'],
        colWidths: [30, 10],
    });
    
    results.forEach(([wallet, status]) => {
        table.push([wallet, chalk[status === 'Success' ? 'green' : 'red'](status)]);
    });

    console.log(table.toString());
    logger.info("Script execution completed");
})();
