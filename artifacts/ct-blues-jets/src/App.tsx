import React, { useRef } from 'react';
import { motion, useScroll, useTransform, useSpring } from 'framer-motion';

// --- Constants & Assets ---
const BASE_URL = import.meta.env.BASE_URL;
const HERO_IMG = BASE_URL + 'images/hero.jpg';
const RIVER_IMG = BASE_URL + 'images/hero-dark-river.jpg';
const GHOST_IMG = BASE_URL + 'images/hero-ghost-country.jpg';
const YOUTUBE_URL = 'https://www.youtube.com/watch?v=zKlfY1w7B78&list=OLAK5uy_kkER4T9y5eaOBshgjPZk-_H635Fa1zu28';

// --- Components ---

function ParallaxImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  });
  const y = useTransform(scrollYProgress, [0, 1], ["-20%", "20%"]);

  return (
    <div ref={ref} className={`relative overflow-hidden ${className}`}>
      <motion.img 
        src={src} 
        alt={alt} 
        style={{ y }} 
        className="absolute inset-0 w-full h-[140%] object-cover object-center -top-[20%]" 
      />
      <div className="absolute inset-0 bg-background/40 mix-blend-multiply" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-transparent to-background/80" />
    </div>
  );
}

function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 1.2, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function App() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  });

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-primary-foreground relative">
      {/* Noise Overlay */}
      <div 
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Progress Bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 bg-primary/50 origin-left z-40"
        style={{ scaleX }}
      />

      {/* 1. Hero Section */}
      <section className="relative h-screen w-full flex flex-col items-center justify-center overflow-hidden">
        <motion.div 
          className="absolute inset-0 z-0"
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          transition={{ duration: 10, ease: "easeOut" }}
        >
          <img 
            src={HERO_IMG} 
            alt="Amber dirt road at sunset" 
            className="w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-background/60" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-90" />
        </motion.div>

        <div className="relative z-10 text-center px-6 max-w-5xl mx-auto mt-20">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="text-primary text-xl md:text-2xl uppercase tracking-[0.3em] font-sans mb-6"
          >
            Collin Taylor & the Blues Jets
          </motion.h2>
          <motion.h1 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, delay: 0.5 }}
            className="text-5xl md:text-7xl lg:text-8xl leading-[0.9] text-foreground mb-8 drop-shadow-2xl"
          >
            Boars Head,<br />
            <span className="text-muted-foreground/80 text-4xl md:text-6xl italic font-serif">Torn Eyes,</span><br />
            And The Cluck<br />
            <span className="text-primary/90 text-4xl md:text-6xl">Of Sick Gore</span>
          </motion.h1>
        </div>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1.5 }}
          className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4 text-muted-foreground"
        >
          <span className="text-xs uppercase tracking-widest font-sans">Scroll</span>
          <div className="w-[1px] h-12 bg-gradient-to-b from-muted-foreground to-transparent animate-pulse" />
        </motion.div>
      </section>

      {/* 2. The Record (Intro) */}
      <section className="py-32 px-6 max-w-3xl mx-auto text-center">
        <FadeIn>
          <p className="text-2xl md:text-3xl leading-relaxed text-foreground/90 font-sans italic">
            "These aren't songs you sing. They're songs you survive. Nine tracks scraped from the floorboards of a condemned cabin, recorded while the storm broke the windows."
          </p>
        </FadeIn>
        <FadeIn delay={0.2} className="mt-12">
          <div className="w-12 h-[1px] bg-primary/50 mx-auto" />
        </FadeIn>
        <FadeIn delay={0.4} className="mt-12 text-lg text-muted-foreground leading-loose">
          Collin Taylor didn't write this album to be heard on a playlist. It was bled out onto a Tascam 4-track in the dead of winter. The Blues Jets aren't a band—they're the creak of the chair, the wind in the mics, the ghosts harmonizing in the corners. This is country-folk stripped of its rhinestone lies. Just old bones, dust, and truth.
        </FadeIn>
      </section>

      {/* 3. Dark River */}
      <section className="relative h-[80vh] w-full flex items-center justify-center">
        <ParallaxImage src={RIVER_IMG} alt="Moonlit river at night" className="absolute inset-0" />
        <div className="relative z-10 px-6 max-w-4xl text-center">
          <FadeIn>
            <h3 className="text-3xl md:text-5xl font-serif text-foreground leading-tight drop-shadow-xl">
              "The water's too deep to stand,<br />
              <span className="text-primary italic">and too cold to swim.</span>"
            </h3>
          </FadeIn>
        </div>
      </section>

      {/* 4. Tracklist */}
      <section className="py-32 px-6 max-w-5xl mx-auto grid md:grid-cols-2 gap-16 md:gap-8">
        <div>
          <FadeIn>
            <h4 className="text-sm text-primary uppercase tracking-[0.4em] mb-12">Side A — The Rot</h4>
            <ul className="space-y-6 text-xl text-foreground font-sans">
              <li className="flex gap-6 border-b border-border/30 pb-4">
                <span className="text-muted-foreground font-serif">01</span>
                <span>Spitting Blood at the Moon</span>
              </li>
              <li className="flex gap-6 border-b border-border/30 pb-4">
                <span className="text-muted-foreground font-serif">02</span>
                <span>Gravel and Glass</span>
              </li>
              <li className="flex gap-6 border-b border-border/30 pb-4">
                <span className="text-muted-foreground font-serif">03</span>
                <span>Boars Head</span>
              </li>
              <li className="flex gap-6 border-b border-border/30 pb-4">
                <span className="text-muted-foreground font-serif">04</span>
                <span>Torn Eyes</span>
              </li>
            </ul>
          </FadeIn>
        </div>
        <div>
          <FadeIn delay={0.2}>
            <h4 className="text-sm text-primary uppercase tracking-[0.4em] mb-12">Side B — The Ruin</h4>
          </FadeIn>
        </div>
      </section>

      {/* 5. Ghost Country */}
      <section className="relative h-[90vh] w-full flex items-end pb-32">
        <ParallaxImage src={GHOST_IMG} alt="Weathered hands on guitar strings" className="absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <div className="relative z-10 px-6 max-w-2xl mx-auto md:mx-12 lg:mx-32">
          <FadeIn>
          </FadeIn>
        </div>
      </section>

      {/* 6. Outro & CTA */}
      <section className="py-40 px-6 text-center flex flex-col items-center justify-center bg-background relative z-10">
        <FadeIn>
          <h2 className="text-4xl md:text-6xl font-serif mb-12 max-w-3xl mx-auto leading-tight">
            The record is spinning.<br />
            <span className="text-muted-foreground italic">Are you listening?</span>
          </h2>
          
          <a 
            href={YOUTUBE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative inline-flex items-center justify-center gap-4 px-12 py-6 border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors duration-500 overflow-hidden"
          >
            <span className="relative z-10 font-sans text-lg uppercase tracking-[0.2em]">
              Listen Now on YouTube
            </span>
          </a>
        </FadeIn>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border/20 text-center text-muted-foreground text-sm flex flex-col md:flex-row items-center justify-center gap-6 px-6 relative z-10">
        <span>© {new Date().getFullYear()} Collin Taylor & the Blues Jets</span>
        <span className="hidden md:inline text-border">•</span>
        <span>All Rights Reserved</span>
      </footer>
    </div>
  );
}
