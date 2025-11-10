'use client';

interface Props {
  items: string[];
}

export default function Ticker({ items }: Props) {
  const marquee = items.length ? items.join(' • ') : 'No active breaches';
  return (
    <div className="fixed bottom-0 left-0 right-0 h-12 overflow-hidden bg-black/80 text-sm text-white">
      <div className="animate-marquee whitespace-nowrap py-3 pl-6">
        Active Breaches: {marquee}
      </div>
      <style jsx>{`
        .animate-marquee {
          animation: marquee 20s linear infinite;
        }
        @keyframes marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  );
}
