"use client";

import React from "react";
import { ContainerScroll } from "./ui/container-scroll-animation";

export function JfpHeroScrollDemo() {
  return (
    <div className="flex flex-col overflow-hidden pb-[220px] pt-[160px] md:pb-[360px] md:pt-[420px] bg-gradient-to-b from-white via-[#111111] to-black">
      <ContainerScroll
        titleComponent={
          <>
            <p className="mb-3 font-black uppercase tracking-[0.22em] text-[#E30613] text-xs md:text-sm">
              Modern player pathway
            </p>
            <h2 className="mx-auto max-w-5xl font-black italic uppercase text-5xl leading-[0.86] tracking-[-0.05em] text-white md:text-[6rem]">
              One program. <br />
              <span className="text-[#E30613]">Three environments.</span> <br />
              Real standards.
            </h2>
          </>
        }
      >
        <div className="relative h-full w-full overflow-hidden rounded-2xl bg-black">
          <img
            src="/images/training/jfp/jfp-training-3.webp"
            alt="Joner Football Performance player training inside the JFP program"
            height={720}
            width={1400}
            className="mx-auto h-full w-full rounded-2xl object-cover object-center"
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <div className="absolute bottom-5 left-5 right-5 md:bottom-8 md:left-8 md:right-8">
            <p className="font-black uppercase tracking-[0.22em] text-[#E30613] text-xs">JFP</p>
            <h3 className="mt-2 max-w-3xl font-black italic uppercase text-3xl leading-[0.9] tracking-[-0.04em] text-white md:text-6xl">
              Train with energy, detail and purpose.
            </h3>
          </div>
        </div>
      </ContainerScroll>
    </div>
  );
}
