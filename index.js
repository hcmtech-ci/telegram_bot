const { Telegraf, Markup } = require('telegraf');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('HCM Sales Ledger Bot is running alive!'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

if (!process.env.BOT_TOKEN || !process.env.SPREADSHEET_ID) {
  console.error("Error: BOT_TOKEN and SPREADSHEET_ID are required!");
  process.exit(1);
}

const serviceAccountAuth = new JWT({
  keyFile: './credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

async function initSheets() {
  try {
    await doc.loadInfo();
    console.log(`Connected to Sheet: ${doc.title}`);
  } catch (err) {
    console.error("Google Sheets Error:", err);
  }
}
initSheets();

const bot = new Telegraf(process.env.BOT_TOKEN);

const mainMenu = Markup.keyboard([
  ['📊 Today Report', '📅 Monthly Report'],
  ['📈 All Time Report']
]).resize();

bot.start((ctx) => {
  return ctx.reply('🏪 HCM Sales Ledger Bot မှ ကြိုဆိုပါတယ်ခင်ဗျာ။\n\nစာရင်းသွင်းရန် VPN Details ကို ပို့ပေးပါ။', mainMenu);
});

bot.on('text', async (ctx, next) => {
  const text = ctx.message.text;
  if (text.includes('Report')) return next();

  // စာသားထဲကနေ အချက်အလက်တွေကို စာလုံးအကြီးအသေးမရွေး ဖတ်နိုင်အောင် ပြင်ဆင်ထားခြင်း
  const nameMatch = text.match(/(?:NAME|User):\s*([^\n]+)/i);
  const typeMatch = text.match(/(?:VPN TYPE|Package):\s*([^\n]+)/i);
  const moneyMatch = text.match(/(?:MONEY|Price):\s*(\d+)/i);
  const expMatch = text.match(/(?:EXPER-DATE|Expiry):\s*([^\n]+)/i);
  const keyMatch = text.match(/(?:VPN KEY|Key):\s*\n*\n*([A-Za-z0-9\-_+=/]+)/i);
  const linkMatch = text.match(/(?:WEB LINK|Link):\s*([^\n]*)/i);
  const adminMatch = text.match(/(?:ရောင်းချသူ Admin|SELLER):\s*([^\n]+)/i);

  // မဖြစ်မနေ ပါရမယ့် Name, Type နဲ့ Money ကို စစ်ဆေးခြင်း
  if (!nameMatch || !typeMatch || !moneyMatch) {
    return ctx.reply('⚠️ VPN Details Format မဟုတ်ပါဘူးခင်ဗျာ။\n\nစာရင်းသွင်းရန် ပုံစံဥပမာ-\n\nNAME: Hein Htet\nVPN TYPE: 1 Month\nMONEY: 5000\nEXPER-DATE: 18/7/2026\nVPN KEY: ABC123XYZ\nWEB LINK: -\nရောင်းချသူ Admin: Owner-HCM');
  }

  const userName = nameMatch[1].trim();
  const vpnType = typeMatch[1].trim();
  const money = parseInt(moneyMatch[1]);
  const experDate = expMatch ? expMatch[1].trim() : '-';
  const vpnKey = keyMatch ? keyMatch[1].trim() : '-';
  const webLink = linkMatch && linkMatch[1] ? linkMatch[1].trim() : '-';
  
  const rawAdmin = adminMatch ? adminMatch[1].trim() : '';
  let seller = 'Owner-HCM';
  if (rawAdmin.toLowerCase().includes('admin') || rawAdmin.toLowerCase().includes('cm')) {
    seller = 'Admin-CM';
  }

  let renewStatus = 'NEW';
  if (text.toLowerCase().includes('renew') || text.includes('သက်တမ်းတိုး')) {
    renewStatus = 'RENEW';
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { timeZone: 'Asia/Yangon' }); 

  try {
    const sheet = doc.sheetsByIndex[0];
    await sheet.addRow({
      'Date': dateStr,
      'NAME': userName,
      'VPN TYPE': vpnType,
      'EXPER-DATE': experDate,
      'MONEY': money,
      'RENEW': renewStatus,
      'VPN KEY': vpnKey,
      'WEB LINK': webLink,
      'SELLER': seller
    });

    return ctx.reply(`✅ Sheet ထဲ စာရင်းမှတ်ပြီးပါပြီ!\n\n👤 NAME: ${userName}\n📦 VPN TYPE: ${vpnType}\n💰 MONEY: ${money} MMK\n🧑‍💻 SELLER: ${seller}\n🔄 STATUS: ${renewStatus}`);
  } catch (err) {
    console.error(err);
    return ctx.reply('❌ Google Sheet ထဲ စာရင်းသွင်းရာတွင် အမှားအယွင်းရှိသွားပါသည်။');
  }
});

// Sheet ထဲက စာရင်းတွေကို ပြန်ဖတ်ပြီး စာရင်းချုပ်တွက်ပေးသည့် Function
async function generateReport(filterType) {
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-US', { timeZone: 'Asia/Yangon' });
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  let totalSales = 0;
  let totalRevenue = 0;
  let adminRevenue = { 'Owner-HCM': 0, 'Admin-CM': 0 };
  let serviceCount = { 'VPN Keys': 0, 'VPS': 0 };

  rows.forEach(row => {
    const rDate = row.get('Date') || '';
    const rMoney = parseInt(row.get('MONEY')) || 0;
    const rSeller = row.get('SELLER') || 'Owner-HCM';
    const rType = row.get('VPN TYPE') || '';

    let isMatch = false;
    
    if (filterType === 'today') {
      if (rDate === todayStr) isMatch = true;
    } else if (filterType === 'month') {
      if (rDate && rDate.includes('/')) {
        const parts = rDate.split('/');
        const rowMonth = parseInt(parts[0]);
        const rowYear = parseInt(parts[2]);
        if (rowMonth === currentMonth && rowYear === currentYear) isMatch = true;
      }
    } else if (filterType === 'all') {
      isMatch = true;
    }

    if (isMatch) {
      totalSales++;
      totalRevenue += rMoney;
      
      if (adminRevenue[rSeller] !== undefined) {
        adminRevenue[rSeller] += rMoney;
      } else {
        adminRevenue[rSeller] = rMoney;
      }
      
      if (rType.toLowerCase().includes('vps') || rType.toLowerCase().includes('outline') || rType.toLowerCase().includes('3x')) {
        serviceCount['VPS']++;
      } else {
        serviceCount['VPN Keys']++;
      }
    }
  });

  return { totalSales, totalRevenue, adminRevenue, serviceCount, todayStr, monthStr: `${currentYear}-${currentMonth}` };
}

// 📊 Today Report
bot.hears('📊 Today Report', async (ctx) => {
  try {
    const rep = await generateReport('today');
    let msg = `📅 TODAY REPORT (${rep.todayStr})\n\n`;
    msg += `✨ ရောင်းရဦးရေ: ${rep.totalSales} ယောက်\n`;
    msg += `💰 စုစုပေါင်းဝင်ငွေ: ${rep.totalRevenue} MMK\n\n`;
    msg += `🧑‍💻 ADMIN SALES SUMMARY\n`;
    msg += ` ┣━ Owner-HCM: ${rep.adminRevenue['Owner-HCM'] || 0} MMK\n`;
    msg += ` ┗━ Admin-CM: ${rep.adminRevenue['Admin-CM'] || 0} MMK\n\n`;
    msg += `📦 SERVICE SUMMARY\n`;
    msg += ` ┣━ 🌐 VPN Keys: ${rep.serviceCount['VPN Keys'] || 0} ခု\n`;
    msg += ` ┗━ 🖥 VPS (Outline/3X): ${rep.serviceCount['VPS'] || 0} လုံး`;
    
    return ctx.reply(msg);
  } catch (err) {
    console.error(err);
    return ctx.reply('❌ Report ထုတ်ရာတွင် အမှားအယွင်းရှိနေပါသည်။');
  }
});

// 📅 Monthly Report
bot.hears('📅 Monthly Report', async (ctx) => {
  try {
    const rep = await generateReport('month');
    let msg = `📅 MONTHLY REPORT (${rep.monthStr})\n\n`;
    msg += `✨ ယခုလရောင်းရဦးရေ: ${rep.totalSales} ယောက်\n`;
    msg += `💰 ယခုလဝင်ငွေ: ${rep.totalRevenue} MMK\n\n`;
    msg += `🧑‍💻 ADMIN SALES SUMMARY\n`;
    msg += ` ┣━ Owner-HCM: ${rep.adminRevenue['Owner-HCM'] || 0} MMK\n`;
    msg += ` ┗━ Admin-CM: ${rep.adminRevenue['Admin-CM'] || 0} MMK\n\n`;
    msg += `📦 SERVICE SUMMARY\n`;
    msg += ` ┣━ 🌐 VPN Keys: ${rep.serviceCount['VPN Keys'] || 0} ခု\n`;
    msg += ` ┗━ 🖥 VPS (Outline/3X): ${rep.serviceCount['VPS'] || 0} လုံး`;
    
    return ctx.reply(msg);
  } catch (err) {
    console.error(err);
    return ctx.reply('❌ Report ထုတ်ရာတွင် အမှားအယွင်းရှိနေပါသည်။');
  }
});

// 📈 All Time Report
bot.hears('📈 All Time Report', async (ctx) => {
  try {
    const rep = await generateReport('all');
    let msg = `📊 ALL TIME REPORT\n\n`;
    msg += `✨ စုစုပေါင်း User: ${rep.totalSales} ယောက်\n`;
    msg += `💰 စုစုပေါင်းရရှိပြီးငွေ: ${rep.totalRevenue} MMK\n\n`;
    msg += `🧑‍💻 ADMIN SALES SUMMARY\n`;
    msg += ` ┣━ Owner-HCM: ${rep.adminRevenue['Owner-HCM'] || 0} MMK\n`;
    msg += ` ┗━ Admin-CM: ${rep.adminRevenue['Admin-CM'] || 0} MMK\n\n`;
    msg += `📦 SERVICE SUMMARY\n`;
    msg += ` ┣━ 🌐 VPN Keys: ${rep.serviceCount['VPN Keys'] || 0} ခု\n`;
    msg += ` ┗━ 🖥 VPS (Outline/3X): ${rep.serviceCount['VPS'] || 0} လုံး`;
    
    return ctx.reply(msg);
  } catch (err) {
    console.error(err);
    return ctx.reply('❌ Report ထုတ်ရာတွင် အမှားအယွင်းရှိနေပါသည်။');
  }
});

bot.launch();
