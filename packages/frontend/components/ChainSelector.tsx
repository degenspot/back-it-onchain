"use client";

import { useChain } from "./ChainProvider";

import { ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import Image from "next/image";

export function ChainSelector() {
  const { selectedChain, setSelectedChain } = useChain();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const chains = [
    { id: "base", name: "Base", icon: "/icons/base.svg" },
    { id: "stellar", name: "Stellar", icon: "/icons/stellar.svg" },
  ];

  const currentChain = chains.find((c) => c.id === selectedChain) || chains[0];

  return (
    <div className="relative" ref={dropdownRef} data-testid="chain-selector">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`select-none flex items-center gap-6 px-3 py-2 rounded-full border transition-all duration-300 backdrop-blur-md ${selectedChain === "base"
          ? "bg-white/80 border-blue-500/20 text-blue-600 hover:bg-white/60"
          : "bg-white/50 border-gray-200 text-gray-900 hover:bg-white/80"
          }`}
      >
        <Image
          src={currentChain.icon}
          alt={currentChain.name}
          width={100}
          height={100}
          className={`h-5 w-auto object-contain ${currentChain.id === "base" ? "max-w-[50px]" : "max-w-[24px]"}`}
        />
        <span className="font-semibold text-sm hidden sm:inline">
          {currentChain.name}
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="select-none absolute top-full right-0 mt-2 w-48 bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-100/50 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200">
          <div className="p-1">
            {chains.map((chain) => (
              <button
                key={chain.id}
                onClick={() => {
                  setSelectedChain(chain.id as "base" | "stellar");
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${selectedChain === chain.id
                  ? "bg-gray-100 font-bold text-gray-900"
                  : "hover:bg-gray-50 font-medium text-gray-700 hover:text-gray-900"
                  }`}
              >
                <Image
                  src={chain.icon}
                  alt={chain.name}
                  width={100}
                  height={100}
                  className={`h-6 w-auto object-contain ${chain.id === "base" ? "max-w-[50px]" : "max-w-[24px]"}`}
                />
                <span className="text-sm">{chain.name}</span>
                {selectedChain === chain.id && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500"></div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
