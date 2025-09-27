const path = require('path');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');

const app = express();

// Basic config (no .env per requirements)
const PORT = 3000;
const MONGO_URI = 'mongodb://127.0.0.1:27017/calcpro';
const SESSION_SECRET = 'dev-secret';

// Connect DB
// mongoose
//   .connect(MONGO_URI)
//   .then(() => console.log('MongoDB connected'))
//   .catch((err) => {
//     console.error('MongoDB connection error', err);
//     process.exit(1);
//   });

const mongoURI =
  process.env.MONGO_URI ||
  "mongodb+srv://manideep:manu@todocluster.h76u0nm.mongodb.net/?retryWrites=true&w=majority&appName=TodoCluster";

mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ Mongo Error:", err));


// Views and static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
// expose session to views
app.use((req, res, next) => { res.locals.session = req.session; next(); });
app.use('/public', express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 },
    store: MongoStore.create({ mongoUrl: MONGO_URI })
  })
);

// Models
const User = require('./src/models/User');
const History = require('./src/models/History');

// Load current user for views
app.use(async (req, res, next) => {
  try {
    if (req.session.userId) {
      const user = await User.findById(req.session.userId).select('name').lean();
      res.locals.currentUser = user || null;
    } else {
      res.locals.currentUser = null;
    }
  } catch (_) {
    res.locals.currentUser = null;
  }
  next();
});

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/signin');
  next();
}

// Routes
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.redirect('/signin');
});

app.get('/signup', (req, res) => {
  res.render('auth/signup', { title: 'Sign Up' });
});

app.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).render('auth/signup', { title: 'Sign Up', error: 'All fields required' });
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).render('auth/signup', { title: 'Sign Up', error: 'Email already registered' });
    const user = await User.create({ name, email, password }); // no bcrypt per requirements
    req.session.userId = user._id.toString();
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).render('auth/signup', { title: 'Sign Up', error: 'Server error' });
  }
});

app.get('/signin', (req, res) => {
  res.render('auth/signin', { title: 'Sign In' });
});

app.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password }); // no bcrypt per requirements
    if (!user) return res.status(401).render('auth/signin', { title: 'Sign In', error: 'Invalid credentials' });
    req.session.userId = user._id.toString();
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).render('auth/signin', { title: 'Sign In', error: 'Server error' });
  }
});

app.post('/signout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/signin');
  });
});

app.get('/dashboard', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const history = await History.find({ userId }).sort({ createdAt: -1 }).limit(20).lean();
  res.render('dashboard', { title: 'Dashboard', history });
});

app.post('/calculate', requireAuth, async (req, res) => {
  try {
    let { expression, ai } = req.body;
    const useAi = Boolean(ai);
    if (typeof expression !== 'string' || expression.trim() === '') {
      return res.status(400).json({ ok: false, error: 'Invalid expression' });
    }
    let steps = [];

    function smartFix(expr) {
      // Collapse duplicate operators like 2++2 -> 2+2, 3**2 -> 3*2
      let fixed = expr.replace(/([+\-*/%])\1+/g, '$1');
      // Remove leading operators except minus
      fixed = fixed.replace(/^[+*/%]+/, '');
      // Remove trailing operators and dots
      fixed = fixed.replace(/[+\-*/%.\s]+$/g, '');
      // Balance parentheses by removing extra closing
      let open = 0; let out = '';
      for (const ch of fixed) {
        if (ch === '(') { open++; out += ch; }
        else if (ch === ')') { if (open > 0) { open--; out += ch; } }
        else { out += ch; }
      }
      // Add closing parentheses if missing
      out += ')'.repeat(Math.max(0, open));
      return out;
    }

    function nlToMath(text) {
      const t = text.toLowerCase().trim();
      // normalize common worded operators
      let normalized = t
        .replace(/^what is\s+/, '')
        .replace(/\s+plus\s+/g, ' + ')
        .replace(/\s+(minus|subtract|sub)\s+/g, ' - ')
        .replace(/\s+(times|multiplied by|into|mul|multiply)\s+/g, ' * ')
        .replace(/\s+(divided by|over|div|divide)\s+/g, ' / ')
        .replace(/\s+(mod|modulo|remainder)\s+/g, ' % ')
        .replace(/\s+(to the power of|power of|power|raised to)\s+/g, ' ** ')
        .replace(/\s+x\s+/g, ' * ')
        .replace(/[,:;!?]/g, '')
        .replace(/\bpoint\b/g, '.')
        .replace(/\bdot\b/g, '.')
        // remove filler phrases like 'is equals to', 'equals', 'is equal to'
        .replace(/\b(is\s+)?(equal(s)?\s+to|equals?)\b/g, ' ')
        .replace(/\bis\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // convert basic number words to digits
      const words = {
        zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
        ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
        twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90'
      };
      normalized = normalized.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g, (m) => words[m]);
      // handle "point five" -> ".5"
      normalized = normalized.replace(/\bpoint\s+(\d+)\b/g, '.$1');
      // if starts with dot, prefix zero
      if (normalized.startsWith('.')) normalized = '0' + normalized;

      // suffix forms: squared, cubed
      normalized = normalized
        .replace(/(\d+(?:\.\d+)?)\s*squared\b/g, '($1**2)')
        .replace(/(\d+(?:\.\d+)?)\s*cubed\b/g, '($1**3)');

      // roots first (can appear in natural questions)
      // roots
      const nthRoot = normalized.match(/(\d+)(?:st|nd|rd|th)?\s+root\s+of\s+(\d+(?:\.\d+)?)/);
      if (nthRoot) {
        const n = parseInt(nthRoot[1], 10);
        const x = parseFloat(nthRoot[2]);
        steps.push(`Using nth root: ${n}th root of ${x} = ${x} ** (1/${n})`);
        return `${x}**(1/${n})`;
      }
      const cubeRoot = normalized.match(/cube\s+root\s+of\s+(\d+(?:\.\d+)?)/);
      if (cubeRoot) {
        const x = parseFloat(cubeRoot[1]);
        steps.push(`Cube root of ${x} = ${x} ** (1/3)`);
        return `${x}**(1/3)`;
      }
      const squareRoot = normalized.match(/(square\s+root|sqrt|root)\s+of\s+(\d+(?:\.\d+)?)/);
      if (squareRoot) {
        const x = parseFloat(squareRoot[2]);
        steps.push(`Square root of ${x} = ${x} ** 0.5`);
        return `${x}**0.5`;
      }
      // simple patterns
      const percent = normalized.match(/(\d+(?:\.\d+)?)% of (\d+(?:\.\d+)?)/);
      if (percent) {
        const p = parseFloat(percent[1]);
        const n = parseFloat(percent[2]);
        steps.push(`${p}% of ${n} = (${p}/100) * ${n}`);
        return `(${p}/100)*${n}`;
      }
      const sumSquares = normalized.match(/sum of first (\d+) squares/);
      if (sumSquares) {
        const n = parseInt(sumSquares[1], 10);
        steps.push(`Using formula n(n+1)(2n+1)/6 for sum of squares`);
        return `(${n}*(${n}+1)*(2*${n}+1))/6`;
      }

      // sentence forms: add/subtract/multiply/divide patterns
      let m;
      m = normalized.match(/^add\s+([0-9.()]+)\s+(and|to)\s+([0-9.()]+)$/);
      if (m) { steps.push(`Add ${m[1]} and ${m[3]}`); return `${m[1]}+${m[3]}`; }
      m = normalized.match(/^subtract\s+([0-9.()]+)\s+from\s+([0-9.()]+)$/);
      if (m) { steps.push(`Subtract ${m[1]} from ${m[2]}`); return `${m[2]}-${m[1]}`; }
      m = normalized.match(/^(multiply|mul)\s+([0-9.()]+)\s+(by\s+)?([0-9.()]+)$/);
      if (m) { steps.push(`Multiply ${m[2]} by ${m[4]}`); return `${m[2]}*${m[4]}`; }
      m = normalized.match(/^divide\s+([0-9.()]+)\s+(by|over)\s+([0-9.()]+)$/);
      if (m) { steps.push(`Divide ${m[1]} by ${m[3]}`); return `${m[1]}/${m[3]}`; }

      // strip trailing operators
      normalized = normalized.replace(/[+\-*/%.\s]+$/g, '');
      // If normalized contains any digits and operators after replacements, return as-is
      if (/^[0-9()+\-*/.%\s**]+$/.test(normalized) && /\d/.test(normalized)) {
        steps.push(`Parsed NL to expression: ${normalized}`);
        return normalized;
      }
      // Fallback: remove any leftover letters/symbols except math tokens
      let fallback = normalized
        .replace(/=/g, ' ')
        .replace(/[^0-9()+\-*/.%\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[+\-*/%.\s]+$/g, '');
      if (/\d/.test(fallback) && /^[0-9()+\-*/.%\s**]+$/.test(fallback)) {
        steps.push(`Fallback NL cleanup -> ${fallback}`);
        return fallback;
      }
      return null;
    }

    function unitConvert(text) {
      const m = text.toLowerCase().trim();
      const usdInr = m.match(/(\d+(?:\.\d+)?)\s*usd\s*in\s*inr/);
      if (usdInr) {
        const v = parseFloat(usdInr[1]);
        const rate = 83; // static example rate
        steps.push(`Using static FX rate: 1 USD = ${rate} INR`);
        return `${v}*${rate}`;
      }
      const length = m.match(/(\d+(?:\.\d+)?)\s*km\s*\+\s*(\d+(?:\.\d+)?)\s*m/);
      if (length) {
        const km = parseFloat(length[1]);
        const m2 = parseFloat(length[2]);
        steps.push(`Convert km to m: ${km} km = ${km*1000} m`);
        return `(${km}*1000)+${m2}`;
      }
      return null;
    }

    let toEvaluate = expression;
    if (useAi) {
      const unitExpr = unitConvert(toEvaluate);
      if (unitExpr) { steps.push(`Unit/Currency parsed: ${toEvaluate} -> ${unitExpr}`); toEvaluate = unitExpr; }
      const nl = nlToMath(toEvaluate);
      if (nl) { steps.push(`NL parsed: ${toEvaluate} -> ${nl}`); toEvaluate = nl; }
      const fixed = smartFix(toEvaluate);
      if (fixed !== toEvaluate) { steps.push(`Smart fix: ${toEvaluate} -> ${fixed}`); toEvaluate = fixed; }
    }

    const sanitized = toEvaluate.replace(/[^0-9+\-*/().% ]/g, '');
    let result;
    try {
      result = Function(`"use strict"; return (${sanitized})`)();
    } catch (e) {
      return res.status(400).json({ ok: false, error: 'Evaluation error' });
    }
    if (typeof result === 'number' && Number.isFinite(result)) {
      const record = await History.create({ userId: req.session.userId, expression: useAi ? `${expression}` : sanitized, result, steps });
      return res.json({ ok: true, result: record.result, steps });
    }
    return res.status(400).json({ ok: false, error: 'Invalid result' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));


// History APIs
app.delete('/history/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const del = await History.deleteOne({ _id: id, userId: req.session.userId });
    if (del.deletedCount === 1) return res.json({ ok: true });
    return res.status(404).json({ ok: false });
  } catch (e) {
    return res.status(500).json({ ok: false });
  }
});

app.post('/history/clear', requireAuth, async (req, res) => {
  try {
    await History.deleteMany({ userId: req.session.userId });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false });
  }
});

