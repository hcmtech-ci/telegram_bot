const { Telegraf, Markup } = require('telegraf');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// Express Server Setup (Render ဒေါင်းမသွားစေရန်)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('HCM Sales Ledger Bot is running alive!'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Env variables စစ်ဆေးခြင်း
if (!process.env.BOT_TOKEN || !process.env.SPREADSHEET_ID) {
  console.error("Error: BOT_TOKEN and SPREADSHEET_ID are required!");
  process.exit(1);
}

// Google Sheets Auth
const serviceAccountAuth = new JWT({
  keyFile: './credentials.json', // Render ၏ Secret Files ထဲတွင် ထည့်ထားရမည့်ဖိုင်နာမည်
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

async function initSheets() {
  try {
    await doc.loadInfo();
    console.log(`Connected to Google Sheet: ${doc.title}`);
  } catch (err) {
    console.error("Google Sheets Connection Error:", err);
  }
}
initSheets();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Main Menu Buttons
const mainMenu = Markup.keyboard([
  ['📊 Today Report', '📅 Monthly Report'],
  ['📈 All Time Report']
]).resize();

bot.start((ctx) => {
  return ctx.reply('🏪 HCM Sales Ledger Bot မှ ကြိုဆိုပါတယ်ခင်ဗျာ။\n\nစာရင်းသွင်းရန် VPN Details ကို ပို့ပေးပါ။ Report ကြည့်ရန် အောက်က ခလုတ်များကို နှိပ်ပါ။', mainMenu);
});

// စာရင်းအလိုအလျောက်ဖတ်ပြီး Sheet ထဲသွင်းသည့်အပိုင်း
bot.on('text', async (ctx, next) => {
  const text = ctx.message.text;

  // ခလုတ်စာသားများဖြစ်ပါက ကျော်သွားရန်
  if (text.includes('Report')) return next();

  // Regex ဖြင့် စာသားထဲက Data များထုတ်ယူခြင်း
  const userMatch = text.match(/User:\s*([^\n]+)/i);
  const packageMatch = text.match(/Package\s*:\s*([^\n]+)/i);
  const priceMatch = text.match(/Price:\s*(\d+)/i);
  const adminMatch = text.match(/ရောင်းချသူ Admin:\s*([^\n]+)/i);
  const keyMatch = text.match(/Key:\s*\n*\n*([A-Z0-9]+)/i);

  if (!packageMatch || !priceMatch) {
    return ctx.reply('⚠️ VPN Details Format မဟုတ်ပါဘူးခင်ဗျာ။ ပြန်လည်စစ်ဆေးပေးပါ။');
  }

  const userName = userMatch ? userMatch[1].trim() : 'Unknown';
  const packageName = packageMatch[1].trim();
  const price = parseInt(priceMatch[1]);
  const adminName = adminMatch ? adminMatch[1].trim() : 'Owner-HCM';
  const vpnKey = keyMatch ? keyMatch[1].trim() : 'No Key';
  
  // ရက်စွဲသတ်မှတ်ခြင်း
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { timeZone: 'Asia/Yangon' }); // "6/18/2026" shape
  const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'); // "2026-06"

  // Service Type ခွဲခြားခြင်း (VPN သို့မဟုတ် VPS)
  let serviceType = 'VPN Keys';
  if (packageName.toLowerCase().includes('vps') || packageName.toLowerCase().includes('outline') || packageName.toLowerCase().includes('3x')) {
    serviceType = 'VPS';
  }

  try {
    const sheet = doc.sheetsByIndex[0];
    await sheet.addRow({
      'User Name': userName,
      'Package': packageName,
      'Price': price,
      'Admin': adminName,
      'VPN Key': vpnKey,
      'Service Type': serviceType,
      'Date': dateStr,
      'Month': monthStr
    });

    return ctx.reply(`✅ စာရင်းမှတ်ပြီးပါပြီ!\n\n👤 User: ${userName}\n📦 Package: ${packageName}\n💰 Price: ${price} MMK\n🧑‍💻 Admin: ${adminName}`);
  } catch (err) {
    console.error(err);
    return ctx.reply('❌ Google Sheet ထဲ စာရင်းသွင်းရာတွင် အမှားအယွင်းရှိသွားပါသည်။');
  }
});

// Google Sheet ထဲက Data တွေကို ဖတ်ပြီး Report ပြန်တွက်ပေးသည့် Function
async function generateReport(filterType) {
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-US', { timeZone: 'Asia/Yangon' });
  const currentMonthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  let totalSales = 0;
  let totalRevenue = 0;
  
  let adminRevenue = { 'Owner-HCM': 0, 'Admin-CM': 0 };
  let serviceCount = { 'VPN Keys': 0, 'VPS': 0 };

  rows.forEach(row => {
    const rDate = row.get('Date');
    const rMonth = row.get('Month');
    const rPrice = parseInt(row.get('Price')) || 0;
    const rAdmin = row.get('Admin') || 'Owner-HCM';
    const rType = row.get('Service Type') || 'VPN Keys';

    let isMatch = false;
    if (filterType === 'today' && rDate === todayStr) isMatch = true;
    if (filterType === 'month' && rMonth === currentMonthStr) isMatch = true;
    if (filterType === 'all') isMatch = true;

    if (isMatch) {
      totalSales++;
      totalRevenue += rPrice;
      
      if (adminRevenue[rAdmin] !== undefined) adminRevenue[rAdmin] += rPrice;
      else adminRevenue[rAdmin] = rPrice;

      if (serviceCount[rType] !== undefined) serviceCount[rType]++;
      else serviceCount[rType] = 1;
    }
  });

  return { totalSales, totalRevenue, adminRevenue, serviceCount, todayStr, currentMonthStr };
}

// ၁။ Today Report
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
    
    return ctx.replyWithMarkdown(msg);
  } catch (err) {
    console.error(err);
    return ctx.reply('❌ Report ထုတ်ရာတွင် အမှားအယွင်းရှိနေပါသည်။');
  }
});

// ၂။ Monthly Report
bot.hears('📅 Monthly Report', async (ctx) => {
  try {
    const rep = await generateReport('month');
    let msg = `📅 MONTHLY REPORT (${rep.currentMonthStr})\n\n`;
    msg += `✨ ယခုလရောင်းရဦးရေ: ${rep.totalSales} ယောက်\n`;
    msg += `💰 ယခုလဝင်ငွေ: ${rep.totalRevenue} MMK\n\n`;
    msg += `🧑‍💻 ADMIN SALES SUMMARY\n`;
    msg += ` ┣━ Owner-HCM: ${rep.adminRevenue['Owner-HCM'] || 0} MMK\n`;
    msg += ` ┗━ Admin-CM: ${rep.adminRevenue['Admin-CM'] || 0} MMK\n\n`;
    msg += `📦 **SERVICE SUMMARY**\n`;
    msg += ` ┣━ 🌐 VPN Keys: ${rep.serviceCount['VPN Keys'] || 0} ခု\n`;
    msg += ` ┗━ 🖥 VPS (Outline/3X): ${rep.serviceCount['VPS'] || 0} လုံး`;
    
    return ctx.replyWithMarkdown(msg);
  } catch (err) {
    console.error(err);
    return ctx.reply('❌ Report ထုတ်ရာတွင် အမှားအယွင်းရှိနေပါသည်။');
  }
});

// ၃။ All Time Report
bot.hears('📈 All Time Report', async (ctx) => {
  try {
    const rep = await generateReport('all');
    let msg = `📊 ALL TIME REPORT\n\n`;
    msg += `✨ စုစုပေါင်း User: ${rep.totalSales} ယောက်\n`;
    msg += `💰 Сုစုပေါင်းရရှိပြီးငွေ: ${rep.totalRevenue} MMK\n\n`;
    msg += `🧑‍💻 **ADMIN SALES SUMMARY**\n`;
    msg += ` ┣━ Owner-HCM: ${rep.adminRevenue['Owner-HCM'] || 0} MMK\n`;
    msg += ` ┗━ Admin-CM: ${rep.adminRevenue['Admin-CM'] || 0} MMK\n\n`;
    msg += `📦 SERVICE SUMMARY\n`;
    msg += ` ┣━ 🌐 VPN Keys: ${rep.serviceCount['VPN Keys'] || 0} ခု\n`;
    msg += ` ┗━ 🖥 VPS (Outline/3X): ${rep.serviceCount['VPS'] || 0} လုံး`;
    
    return ctx.replyWithMarkdown(msg);
  } catch (err) {
    console.error(err);
    return ctx.reply('❌ Report ထုတ်ရာတွင် အမှားအယွင်းရှိနေပါသည်။');
  }
});

bot.launch();
