import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight, ArrowRight, Plus, Minus } from 'lucide-react';

const INK = '#1C160F';
const SOFT = '#6E6151';
const FAINT = '#9C8E7A';
const LINE = '#CFC2AC';
const LINE_DARK = '#AA9B82';
const BG = '#EDE6D8';

const spring = { type: 'spring', stiffness: 320, damping: 24, mass: 0.8 };
const softSpring = { type: 'spring', stiffness: 180, damping: 20 };

const rooms = [
  {
    n: '01',
    name: 'The Listening Library',
    desc: '12 desks among 4,300 LPs on open shelving. One mono speaker per aisle, kept low. The catalogue plays in the order it was acquired — 1962 onward.',
    meta: ['12 desks', 'Mono playback', 'Floor 2'],
  },
  {
    n: '02',
    name: 'The Pressing Room',
    desc: '8 desks behind the glass wall of our working lathe. Tuesday cuttings are open to members. Bring headphones; the lathe does not pause for calls.',
    meta: ['8 desks', 'Live lathe', 'Floor 1'],
  },
  {
    n: '03',
    name: 'Tape Deck Commons',
    desc: '24 desks under the reel-to-reel wall. Sides flip on the hour, every hour, by hand. The hiss is part of the lease.',
    meta: ['24 desks', 'Reel-to-reel', 'Floor 3'],
  },
  {
    n: '04',
    name: 'Liner Notes Café',
    desc: 'Drop-in tables, pour-over, and the week’s reissues on rotation. Liner notes from the archive are laminated and left at every seat.',
    meta: ['Drop-in', 'Pour-over', 'Street level'],
  },
];

const plans = [
  {
    name: 'Day Pass',
    monthly: 28,
    season: 21,
    unit: '/ day',
    detail: 'Any room, any chair, one sunrise-to-close. Includes one archive pull from the stacks.',
    items: ['All listening rooms', '1 archive pull', 'Café credit'],
    featured: false,
  },
  {
    name: 'Resident',
    monthly: 240,
    season: 156,
    unit: '/ month',
    detail: 'A fixed desk, a brass nameplate, and your own queue piped to the room you sit in.',
    items: ['Fixed desk + nameplate', 'Personal room queue', '24/7 key', 'Tuesday cuttings'],
    featured: true,
  },
  {
    name: 'Studio',
    monthly: 890,
    season: 620,
    unit: '/ month',
    detail: 'A four-person bay in the Pressing Room with a private monitor pair and label-grade acoustics.',
    items: ['4-person bay', 'Private monitors', 'Lathe time, 2h / mo', 'Guest passes ×8'],
    featured: false,
  },
];

const facts = [
  ['1962', 'First opened as a record shop on Greene Street'],
  ['1974', 'Became a label. Pressed 312 records, kept every master'],
  ['2009', 'Became a stream. Kept the shop, kept the shelves'],
  ['2024', 'Became a room again. The desks are new. Nothing else is.'],
];

export default function App() {
  const [billing, setBilling] = useState('season');
  const [openRoom, setOpenRoom] = useState('01');

  return (
    <div style={{ background: BG, color: INK, minHeight: '100vh' }} className="antialiased">
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap"
        rel="stylesheet"
      />
      <style
        dangerouslySetInnerHTML={{
          __html: `
        * { box-sizing: border-box; }
        body { margin: 0; }
        .arc { font-family: 'Archivo', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
        .tnum { font-variant-numeric: tabular-nums; }
        @keyframes ticker {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .ticker { animation: ticker 38s linear infinite; }
        ::selection { background: ${INK}; color: ${BG}; }
        .hairline { border-color: ${LINE}; }
      `,
        }}
      />

      <div className="arc mx-auto" style={{ maxWidth: 1320 }}>
        {/* ============ TOP BAR ============ */}
        <header
          className="grid grid-cols-12 items-stretch border-b"
          style={{ borderColor: LINE_DARK }}
        >
          <div className="col-span-6 md:col-span-3 px-5 py-4 border-r hairline border-r">
            <div className="text-[15px] font-extrabold tracking-tight leading-none">
              SIDE&nbsp;B<span style={{ color: FAINT }}>/</span>ROOMS
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] mt-1" style={{ color: SOFT }}>
              by Greene St. Records
            </div>
          </div>
          <nav className="hidden md:flex col-span-6 items-center gap-8 px-6 border-r hairline text-[12px] uppercase tracking-[0.14em]">
            {['Rooms', 'Membership', 'Archive', 'Visit'].map((l) => (
              <motion.a
                key={l}
                href="#"
                className="relative"
                style={{ color: SOFT }}
                whileHover={{ y: -2, color: INK }}
                transition={spring}
              >
                {l}
              </motion.a>
            ))}
          </nav>
          <div className="col-span-6 md:col-span-3 flex items-center justify-end px-5">
            <motion.a
              href="#sale"
              className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] px-4 py-2"
              style={{ background: INK, color: BG }}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              transition={spring}
            >
              Winter sale <ArrowUpRight size={14} />
            </motion.a>
          </div>
        </header>

        {/* ============ HERO ============ */}
        <section className="grid grid-cols-12 border-b" style={{ borderColor: LINE_DARK }}>
          <div className="col-span-12 md:col-span-9 border-r hairline px-5 md:px-6 pt-12 md:pt-20 pb-10">
            <p className="text-[11px] uppercase tracking-[0.22em] mb-8" style={{ color: SOFT }}>
              The Winter Residency Sale — Dec 01 → Dec 21
            </p>
            <h1
              className="font-extrabold tracking-[-0.035em] leading-[0.92]"
              style={{ fontSize: 'clamp(44px, 8.4vw, 118px)' }}
            >
              Work where
              <br />
              the records
              <br />
              never left.
            </h1>
            <div className="grid grid-cols-12 mt-12 gap-y-6">
              <p
                className="col-span-12 md:col-span-6 text-[15px] leading-relaxed pr-8"
                style={{ color: SOFT }}
              >
                Sixty-two years ago this building sold records. Then it pressed them. Then it
                streamed them. This winter it adds desks — forty-four of them, set between the
                stacks, the lathe, and the tape wall. Season passes are{' '}
                <span style={{ color: INK }} className="font-semibold">
                  35% off
                </span>{' '}
                until the solstice.
              </p>
              <div className="col-span-12 md:col-span-6 md:pl-8 flex items-end">
                <motion.a
                  href="#membership"
                  className="inline-flex items-center gap-3 text-[13px] font-bold uppercase tracking-[0.14em] px-6 py-4"
                  style={{ background: INK, color: BG }}
                  whileHover={{ scale: 1.05, x: 4 }}
                  whileTap={{ scale: 0.96 }}
                  transition={spring}
                >
                  Claim a winter desk <ArrowRight size={16} />
                </motion.a>
              </div>
            </div>
          </div>

          {/* hero rail */}
          <div className="col-span-12 md:col-span-3 flex md:flex-col">
            {[
              ['44', 'desks among the stacks'],
              ['4,300', 'LPs within reach'],
              ['−35%', 'on every season pass'],
            ].map(([num, label], i) => (
              <div
                key={label}
                className={`flex-1 px-5 py-6 ${i < 2 ? 'border-r md:border-r-0 md:border-b hairline' : ''}`}
              >
                <div className="text-4xl md:text-5xl font-bold tracking-tight tnum">{num}</div>
                <div
                  className="text-[11px] uppercase tracking-[0.16em] mt-2"
                  style={{ color: SOFT }}
                >
                  {label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ============ TICKER ============ */}
        <div
          className="overflow-hidden border-b py-3 select-none"
          style={{ borderColor: LINE_DARK }}
        >
          <div className="ticker flex whitespace-nowrap text-[12px] uppercase tracking-[0.2em]" style={{ color: SOFT }}>
            {[...Array(2)].map((_, i) => (
              <span key={i} className="flex">
                {[
                  'Est. 1962',
                  'Side B opens Dec 01',
                  '35% off season passes',
                  'Tape sides flip on the hour',
                  'Tuesday lathe cuttings',
                  'The hiss is part of the lease',
                ].map((t) => (
                  <span key={t + i} className="mx-6 flex items-center gap-6">
                    {t} <span style={{ color: LINE_DARK }}>●</span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>

        {/* ============ HERITAGE GRID ============ */}
        <section className="grid grid-cols-2 md:grid-cols-4 border-b" style={{ borderColor: LINE_DARK }}>
          {facts.map(([year, text], i) => (
            <motion.div
              key={year}
              className={`px-5 py-8 ${i < 3 ? 'md:border-r' : ''} ${i % 2 === 0 ? 'border-r md:border-r' : ''} hairline border-b md:border-b-0`}
              whileHover={{ y: -4 }}
              transition={spring}
            >
              <div className="text-2xl font-bold tnum tracking-tight">{year}</div>
              <p className="text-[13px] leading-snug mt-3" style={{ color: SOFT }}>
                {text}
              </p>
            </motion.div>
          ))}
        </section>

        {/* ============ ROOMS ============ */}
        <section className="grid grid-cols-12 border-b" style={{ borderColor: LINE_DARK }}>
          <div className="col-span-12 md:col-span-4 px-5 md:px-6 py-10 md:border-r hairline">
            <p className="text-[11px] uppercase tracking-[0.22em]" style={{ color: SOFT }}>
              The rooms
            </p>
            <h2 className="text-3xl md:text-[40px] font-bold tracking-tight leading-[1.05] mt-4">
              Four rooms,
              <br />
              one catalogue,
              <br />
              no silence.
            </h2>
            <p className="text-[13px] leading-relaxed mt-6 max-w-[36ch]" style={{ color: SOFT }}>
              Every room plays from the house archive. You may not choose the record, but you may
              stay long enough to hear it again.
            </p>
          </div>

          <div className="col-span-12 md:col-span-8">
            {rooms.map((room, i) => {
              const open = openRoom === room.n;
              return (
                <div
                  key={room.n}
                  className={`${i < rooms.length - 1 ? 'border-b' : ''} hairline`}
                >
                  <motion.button
                    onClick={() => setOpenRoom(open ? null : room.n)}
                    className="w-full grid grid-cols-12 items-center px-5 md:px-6 py-6 text-left"
                    whileHover={{ x: open ? 0 : 6 }}
                    transition={spring}
                  >
                    <span className="col-span-2 md:col-span-1 text-[13px] tnum" style={{ color: FAINT }}>
                      {room.n}
                    </span>
                    <span className="col-span-8 md:col-span-9 text-xl md:text-2xl font-bold tracking-tight">
                      {room.name}
                    </span>
                    <span className="col-span-2 flex justify-end">
                      <motion.span
                        animate={{ rotate: open ? 0 : 0, scale: open ? 1.05 : 1 }}
                        transition={spring}
                        className="w-8 h-8 flex items-center justify-center border"
                        style={{ borderColor: open ? INK : LINE_DARK, color: open ? INK : SOFT }}
                      >
                        {open ? <Minus size={14} /> : <Plus size={14} />}
                      </motion.span>
                    </span>
                  </motion.button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={softSpring}
                        className="overflow-hidden"
                      >
                        <div className="grid grid-cols-12 px-5 md:px-6 pb-8 gap-y-4">
                          <p
                            className="col-span-12 md:col-span-7 md:col-start-2 text-[14px] leading-relaxed"
                            style={{ color: SOFT }}
                          >
                            {room.desc}
                          </p>
                          <div className="col-span-12 md:col-span-4 md:pl-6 flex md:flex-col gap-3 flex-wrap">
                            {room.meta.map((m) => (
                              <span
                                key={m}
                                className="text-[11px] uppercase tracking-[0.14em] border px-3 py-1.5 inline-block w-fit"
                                style={{ borderColor: LINE_DARK, color: SOFT }}
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </section>

        {/* ============ MEMBERSHIP / SALE ============ */}
        <section id="membership" className="border-b" style={{ borderColor: LINE_DARK }}>
          <div className="grid grid-cols-12 border-b hairline">
            <div className="col-span-12 md:col-span-8 px-5 md:px-6 py-10 md:border-r hairline">
              <p className="text-[11px] uppercase tracking-[0.22em]" style={{ color: SOFT }} id="sale">
                Membership — Winter Residency Sale
              </p>
              <h2 className="text-3xl md:text-[40px] font-bold tracking-tight leading-[1.05] mt-4">
                The season rate, held since the solstice of ’74.
              </h2>
            </div>
            <div className="col-span-12 md:col-span-4 px-5 md:px-6 py-10 flex items-end">
              {/* Billing toggle */}
              <div className="flex border w-full" style={{ borderColor: LINE_DARK }}>
                {[
                  ['monthly', 'Standard'],
                  ['season', 'Winter −35%'],
                ].map(([key, label]) => {
                  const active = billing === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setBilling(key)}
                      className="relative flex-1 py-3 text-[12px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color: active ? BG : SOFT }}
                    >
                      {active && (
                        <motion.span
                          layoutId="billing-pill"
                          className="absolute inset-0"
                          style={{ background: INK }}
                          transition={spring}
                        />
                      )}
                      <span className="relative z-10">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3">
            {plans.map((plan, i) => {
              const price = billing === 'season' ? plan.season : plan.monthly;
              return (
                <motion.div
                  key={plan.name}
                  className={`px-5 md:px-6 py-8 ${i < 2 ? 'md:border-r' : ''} hairline border-b md:border-b-0 flex flex-col`}
                  whileHover={{ y: -6 }}
                  transition={spring}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold tracking-tight">{plan.name}</h3>
                    {plan.featured && (
                      <span
                        className="text-[10px] uppercase tracking-[0.16em] border px-2.5 py-1"
                        style={{ borderColor: INK }}
                      >
                        Most kept
                      </span>
                    )}
                  </div>

                  <div className="mt-8 flex items-baseline gap-3">
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={billing + plan.name}
                        initial={{ y: 14, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -14, opacity: 0 }}
                        transition={spring}
                        className="text-5xl font-extrabold tracking-tight tnum"
                      >
                        ${price}
                      </motion.span>
                    </AnimatePresence>
                    <span className="text-[12px] uppercase tracking-[0.12em]" style={{ color: SOFT }}>
                      {plan.unit}
                    </span>
                    {billing === 'season' && (
                      <span
                        className="text-[12px] tnum line-through"
                        style={{ color: FAINT }}
                      >
                        ${plan.monthly}
                      </span>
                    )}
                  </div>

                  <p className="text-[13px] leading-relaxed mt-5" style={{ color: SOFT }}>
                    {plan.detail}
                  </p>

                  <ul className="mt-7 mb-10 space-y-0">
                    {plan.items.map((it) => (
                      <li
                        key={it}
                        className="flex items-center justify-between text-[13px] py-2.5 border-b hairline"
                      >
                        <span>{it}</span>
                        <span style={{ color: FAINT }}>—</span>
                      </li>
                    ))}
                  </ul>

                  <motion.button
                    className="mt-auto w-full py-3.5 text-[12px] font-bold uppercase tracking-[0.14em] border"
                    style={
                      plan.featured
                        ? { background: INK, color: BG, borderColor: INK }
                        : { borderColor: INK, color: INK }
                    }
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    transition={spring}
                  >
                    {plan.featured ? 'Take the residency' : 'Reserve'}
                  </motion.button>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* ============ CLOSING STATEMENT ============ */}
        <section className="grid grid-cols-12 border-b" style={{ borderColor: LINE_DARK }}>
          <div className="col-span-12 md:col-span-8 px-5 md:px-6 py-16 md:border-r hairline">
            <p
              className="font-bold tracking-tight leading-[1.08]"
              style={{ fontSize: 'clamp(26px, 4vw, 46px)' }}
            >
              We never digitised the room tone.{' '}
              <span style={{ color: FAINT }}>
                The shelves, the hiss, the Tuesday lathe — some things only stream in person.
              </span>
            </p>
          </div>
          <div className="col-span-12 md:col-span-4 px-5 md:px-6 py-16 flex flex-col justify-between gap-10">
            <div className="text-[12px] uppercase tracking-[0.16em] leading-loose" style={{ color: SOFT }}>
              114 Greene Street
              <br />
              New York, NY 10012
              <br />
              Mon – Sun, 07:00 – 01:00
            </div>
            <motion.a
              href="#"
              className="inline-flex items-center justify-between text-[13px] font-bold uppercase tracking-[0.14em] border px-5 py-4"
              style={{ borderColor: INK }}
              whileHover={{ scale: 1.03, borderColor: INK }}
              whileTap={{ scale: 0.97 }}
              transition={spring}
            >
              Book a listening tour <ArrowUpRight size={16} />
            </motion.a>
          </div>
        </section>

        {/* ============ FOOTER ============ */}
        <footer className="grid grid-cols-12 items-center text-[11px] uppercase tracking-[0.16em] py-5 px-5 md:px-6" style={{ color: SOFT }}>
          <div className="col-span-6 md:col-span-4 font-bold" style={{ color: INK }}>
            SIDE B / ROOMS
          </div>
          <div className="hidden md:block col-span-4 text-center">Sale ends Dec 21 — the longest night</div>
          <div className="col-span-6 md:col-span-4 text-right">© 1962–2024 Greene St. Records</div>
        </footer>
      </div>
    </div>
  );
}