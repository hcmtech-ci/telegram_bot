const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-client');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// Express Server Setup (Render ဒေါင်းမသွားစေရန်)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running alive with Sheets & Supabase!'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Env တွေ စစ်ဆေးခြင်း
if (!process.env.BOT_TOKEN || !process.env.SUPABASE_URL || !process.env.SUPABASE_KEY || !process.env.SPREADSHEET_ID) {
  console.error("Error: Missing Environment Variables!");
  process.exit(1);
}

// 1. Supabase ချိတ်ဆက်ခြင်း
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 2. Google Sheets ချိတ်ဆက်ခြင်း (Secret File အဖြစ်ထည့်ထားသော credentials.json ကို ဖတ်ခြင်း)
const serviceAccountAuth = new JWT({
  keyFile: './credentials.json', // Render ရဲ့ Secret File ထဲမှာ ထည့်ရမယ့် ဖိုင်နာမည်
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

// Bot Start Menu
bot.start((ctx) => {
  return ctx.reply(
    '🌐 VPN အရောင်းစာရင်းမှတ်မည့် Bot (Sheets + Supabase Version) မှ ကြိုဆိုပါတယ်။\n\n' +
    '📝 စာရင်းသွင်းရန်အတွက် VPN Details စာသားကို အပြည့်အစုံ ကူးထည့်ပေးပါ။'
  );
});

// စာသားဝင်လာလျှင် ဖတ်ပြီး စာရင်းသွင်းသည့်အပိုင်း
bot.on('text', async (ctx) => {
  const text = ctx.message.text;

  // ပုံစံတူ စာသားကို ဖတ်ခြင်း (Regex)
  const userMatch = text.match(/User:\s*([^\n]+)/i);
  const packageMatch = text.match(/Package\s*:\s*([^\n]+)/i);
  const priceMatch = text.match(/Price:\s*(\d+)/i);
  const keyMatch = text.match(/Key:\s*\n*\n*([A-Z0-9]+)/i);

  if (!packageMatch || !priceMatch) {
    return ctx.reply('⚠️ VPN Details Format မဟုတ်ပါဘူးခင်ဗျာ။');
  }

  const userName = userMatch ? userMatch[1].trim() : 'Unknown';
  const packageName = packageMatch[1].trim();
  const price = parseInt(priceMatch[1]);
  const vpnKey = keyMatch ? keyMatch[1].trim() : 'No Key';
  const dateStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Yangon' });

  try {
    // ა. Supabase ထဲ စာရင်းသွင်းခြင်း
    const { error: sbError } = await supabase
      .from('vpn_sales') // Supabase ထဲက Table နာမည်
      .insert([{ user_name: userName, package_name: packageName, price: price, vpn_key: vpnKey }]);
    
    if (sbError) console.error("Supabase Insert Error:", sbError);

    // ბ. Google Sheets ထဲ စာရင်းသွင်းခြင်း
    const sheet = doc.sheetsByIndex[0]; // ပထမဆုံး Sheet စာမျက်နှာကို သုံးခြင်း
    await sheet.addRow({
      'User Name': userName,
      'Package': packageName,
      'Price': price,
      'VPN Key': vpnKey,
      'Date': dateStr
    });

    return ctx.reply(`✅ စာရင်းမှတ်ပြီးပါပြီ (Sheets + Supabase)!\n\n👤 User: ${userName}\n📦 Package: ${packageName}\n💰 Price: ${price} MMK`);
  } catch (err) {
    console.error(err);
    return ctx.reply('❌ စာရင်းသွင်းရာတွင် အမှားအယွင်းရှိသွားပါသည်။');
  }
});

bot.launch();
