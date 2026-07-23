import React, { useState } from "react";
import { Image, Text, View } from "react-native";

interface Props {
  ticker: string;
  name?: string;
  size?: number;
  borderRadius?: number;
  bgColor?: string;
  textColor?: string;
}

function logoUrl(ticker: string): string {
  const code = ticker.replace(".KS", "").replace(".KQ", "");
  if (/^\d{6}$/.test(code)) {
    return `https://file.alphasquare.co.kr/media/images/stock_logo/kr/${code}.png`;
  }
  return `https://assets.parqet.com/logos/symbol/${ticker.replace(".KS", "").replace(".KQ", "").toUpperCase()}`;
}

export default function TickerLogo({
  ticker,
  name,
  size = 36,
  borderRadius = 10,
  bgColor = "#f3f4f6",
  textColor = "#374151",
}: Props) {
  const [err, setErr] = useState(false);
  const code = ticker.replace(".KS", "").replace(".KQ", "");
  const fallback = (name ?? code).slice(0, 2).toUpperCase();
  const fontSize = Math.max(10, Math.round(size * 0.38));

  return (
    <View
      style={{
        width: size, height: size, borderRadius,
        backgroundColor: bgColor,
        alignItems: "center", justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {!err ? (
        <Image
          source={{ uri: logoUrl(ticker) }}
          style={{ width: size, height: size }}
          resizeMode="contain"
          onError={() => setErr(true)}
        />
      ) : (
        <Text style={{ fontSize, fontFamily: "Pretendard-Bold", color: textColor }}>
          {fallback}
        </Text>
      )}
    </View>
  );
}
