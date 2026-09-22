import Explorer from "./components/Explorer";
import ChatWidget from "./components/ChatWidget";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <Explorer />
      <ChatWidget />
    </>
  );
}
