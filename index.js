const { Telegraf, Markup } = require('telegraf');
const { Client } = require('pg');
const express = require('express');

// Express App setup (Render အသက်ရှင်နေစေရန်)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('VPN Sales Bot is running alive!'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

if (!process.env.BOT_TOKEN || !process.env.DATABASE_URL) {
  console.error("Error: BOT_TOKEN and DATABASE_URL are required!");
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const db = new Client({ connectionString: process.env.DATABASE_URL });

async function initDB() {
  try {
    await db.connect();
    console.log("Connected to Render PostgreSQL Database!");
    
    // VPN အရောင်းစာရင်းဇယား ဆောက်ခြင်း
    await db.query(`
      CREATE TABLE IF NOT EXISTS vpn_sales (
        id SERIAL PRIMARY KEY,
        user_name TEXT,
        package_name TEXT NOT NULL,
        price INTEGER NOT NULL,
        vpn_key TEXT,
        sale_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}
initDB();

// Bot Menu
bot.start((ctx) => {
  return ctx.reply(
    '🌐 VPN အရောင်းစာရင်းမှတ်မည့် Bot မှ ကြိုဆိုပါတယ်ခင်ဗျာ။\n\n' +
    '📝 စာရင်းသွင်းရန်အတွက် သင့်ရဲ့ VPN Details စာသား (Format အတိုင်း) တစ်ခုလုံးကို Copy, Paste လုပ်ပြီး ပို့ပေးရုံပါပဲ။\n\n' +
    '📊 စာရင်းချုပ်ကြည့်ရန် အောက်က ခလုတ်များကို နှိပ်ပါ-',
    Markup.keyboard([
      ['📊 ဒီနေ့ စာရင်းချုပ်', '📅 ဒီလ စာရင်းချုပ်'],
      ['📦 Package အလိုက် အရောင်းရဆုံး']
    ]).resize()
  );
});

// စာသားထဲမှ လိုအပ်သည်များကို ရှာဖွေပြီး ဖတ်ပေးသည့်အပိုင်း (Regex Engine)
bot.on('text', async (ctx, next) => {
  const text = ctx.message.text;
  
  // ခလုတ်စာသားများဖြစ်ပါက ကျော်သွားရန်
  if (text.startsWith('📊') || text.startsWith('📅') || text.startsWith('📦')) {
    return next();
  }

  // စာသားထဲက အချက်အလက်များကို ပုံစံထုတ်ဖတ်ခြင်း
  const userMatch = text.match(/User:\s*([^\n]+)/i);
  const packageMatch = text.match(/Package\s*:\s*([^\n]+)/i);
  const priceMatch = text.match(/Price:\s*(\d+)/i);
  const keyMatch = text.match(/Key:\s*\n*\n*([A-Z0-9]+)/i);

  // အနည်းဆုံး Package နဲ့ Price ပါမှ စာရင်းသွင်းမည်
  if (!packageMatch || !priceMatch) {
    return ctx.reply('⚠️ ပေးပို့လာသော စာသားသည် သတ်မှတ်ထားသည့် VPN Details Format မဟုတ်ပါဘူးခင်ဗျာ။ ပြန်လည်စစ်ဆေးပေးပါ။');
  }

  const userName = userMatch ? userMatch[1].trim() : 'Unknown';
  const packageName = packageMatch[1].trim();
  const price = parseInt(priceMatch[1]);
  const vpnKey = keyMatch ? keyMatch[1].trim() : 'No Key';

  try {
    // Database ထဲသို့ သိမ်းဆည်းခြင်း
    await db.query(
      `INSERT INTO vpn_sales (user_name, package_name, price, vpn_key) VALUES ($1, $2, $3, $4)`,
      [userName, packageName, price, vpnKey]
    );
    
    return ctx.reply(`✅ VPN အရောင်းစာရင်း မှတ်သားပြီးပါပြီ!\n\n👤 User: ${userName}\n📦 Package: ${packageName}\n💰 Price: ${price} MMK\n🔑 Key: ${vpnKey}`);
  } catch (err) {
    console.error(err);
    return ctx.reply('❌ Database ထဲ စာရင်းသွင်းရာတွင် အမှားအယွင်းရှိသွားပါသည်။');
  }
});

// ၁။ ဒီနေ့ စာရင်းချုပ်
bot.hears('📊 ဒီနေ့ စာရင်းချုပ်', async (ctx) => {
  try {
    const result = await db.query(`
      SELECT COALESCE(SUM(price), 0) AS total, COUNT(*) AS count 
      FROM vpn_sales 
      WHERE sale_date::date = CURRENT_DATE
    `);
    
    const details = await db.query(`
      SELECT package_name, COUNT(*) as qty, SUM(price) as amt 
      FROM vpn_sales 
      WHERE sale_date::date = CURRENT_DATE 
      GROUP BY package_name
    `);

    let report = `📊 **ဒီနေ့ VPN အရောင်းစာရင်းချုပ်**\n\n`;
    report += `🛒 ရောင်းရသည့်အရေအတွက်: ${result.rows[0].count} ခု\n`;
    report += `💰 ဒီနေ့ရောင်းရငွေစုစုပေါင်း: **${result.rows[0].total}** MMK\n\n`;
    report += `📝 **အသေးစိတ် အရောင်းစာရင်း -**\n`;

    if (details.rows.length === 0) {
      report += `- ယနေ့ အရောင်းစာရင်း မရှိသေးပါ။`;
    } else {
      details.rows.forEach(row => {
        report += `- ${row.package_name}: ${row.qty} ခု (စုစုပေါင်း ${row.amt} MMK)\n`;
      });
    }

    return ctx.replyWithMarkdown(report);
  } catch (err) {
    console.error(err);
    return ctx.reply('❌ စာရင်းထုတ်ရာတွင် အမှားအယွင်းရှိနေပါသည်။');
  }
});

// ၂။ ဒီလ စာရင်းချုပ်
bot.hears('📅 ဒီလ စာရင်းချုပ်', async (ctx) => {
  try {
    const result = await db.query(`
      SELECT COALESCE(SUM(price), 0) AS total, COUNT(*) AS count
      FROM vpn_sales 
      WHERE DATE_TRUNC('month', sale_date) = DATE_TRUNC('month', CURRENT_DATE)
    `);

    let report = `📅 **ဒီလအတွင်း VPN အရောင်းစာရင်းချုပ်**\n\n`;
    report += `🛒 စုစုပေါင်းရောင်းရအရေအတွက်: **${result.rows[0].count}** ခု\n`;
    report += `💰 စုစုပေါင်း အရောင်းရငွေ: **${result.rows[0].total}** MMK`;

    return ctx.replyWithMarkdown(report);
  } catch (err) {
    console.error(err);
    return ctx.reply('❌ စာရင်းထုတ်ရာတွင် အမှားအယွင်းရှိနေပါသည်။');
  }
});

// ၃။ Package အလိုက် ဘယ်နှစ်ခုစီ ရောင်းရလဲ
bot.hears('📦 Package အလိုက် အရောင်းရဆုံး', async (ctx) => {
  try {
    const result = await db.query(`
      SELECT package_name, COUNT(*) AS total_qty 
      FROM vpn_sales 
      GROUP BY package_name 
      ORDER BY total_qty DESC
    `);

    let report = `📦 **Package အလိုက် အရောင်းရဆုံးစာရင်း**\n\n`;
    if (result.rows.length === 0) {
      report += `ရောင်းရသည့် Package မရှိသေးပါ။`;
    } else {
      result.rows.forEach((row, index) => {
        report += `${index + 1}. ${row.package_name} - စုစုပေါင်း (${row.total_qty}) ခုရောင်းရပြီး\n`;
      });
    }

    return ctx.reply(report);
  } catch (err) {
    console.error(err);
    return ctx.reply('❌ စာရင်းထုတ်ရာတွင် အမှားအယွင်းရှိနေပါသည်။');
  }
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
