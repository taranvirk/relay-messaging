import { MessageSquareText } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { ChatPanel } from '../components/ChatPanel';
import { ConversationList } from '../components/ConversationList';

export function MessagesPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  return (
    <main className="flex h-screen overflow-hidden bg-ink text-white">
      <AppNav />
      <div className="flex min-w-0 flex-1 pt-16 lg:pt-0">
        <ConversationList mobileHidden={Boolean(conversationId)} />
        {conversationId ? (
          <ChatPanel
            key={conversationId}
            conversationId={conversationId}
            onBack={() => navigate('/messages')}
          />
        ) : (
          <section className="hidden min-w-0 flex-1 place-items-center bg-ink md:grid">
            <div className="max-w-sm text-center">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-signal/20 bg-signal/[0.07] text-signal">
                <MessageSquareText size={28} />
              </span>
              <h2 className="mt-5 font-display text-2xl font-bold">Choose a conversation</h2>
              <p className="mt-2 leading-6 text-mist">
                Your messages stay in sync across reconnects and every device you use.
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
