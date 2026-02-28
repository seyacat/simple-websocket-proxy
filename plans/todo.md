# Host/Guest Mode Implementation - Todo List

## Phase 1: Extend Client State in server.js
- [ ] Modify `activeConnections` storage to include mode and subscription fields
- [ ] Add `mode` (string), `subscribedTo` (string), `subscribers` (Set) to connection objects
- [ ] Update connection initialization in `wss.on('connection')` handler

## Phase 2: Implement Message Type Handlers
- [ ] Add `set_mode` message handler with validation
- [ ] Add `subscribe` message handler with host validation
- [ ] Add `unsubscribe` message handler
- [ ] Modify existing message routing to detect broadcast (message.to === sender's shortToken)

## Phase 3: Implement Subscription Management
- [ ] Create `subscribeGuestToHost(guestToken, hostToken)` function
- [ ] Create `unsubscribeGuest(guestToken)` function
- [ ] Handle automatic cleanup on guest disconnect
- [ ] Handle automatic cleanup on host disconnect (notify all guests)

## Phase 4: Implement Broadcast Logic
- [ ] Modify message routing in `ws.on('message')` handler
- [ ] Detect when host sends to own token → treat as broadcast
- [ ] Create `broadcastToSubscribers(hostToken, message)` function
- [ ] Format broadcast messages with proper type and metadata

## Phase 5: Mode Switching Logic
- [ ] Implement `switchClientMode(clientToken, newMode)` function
- [ ] Clear subscriptions when switching from guest mode
- [ ] Clear subscribers when switching from host mode
- [ ] Send mode change confirmation to client

## Phase 6: Error Handling and Validation
- [ ] Add validation for mode-specific operations
- [ ] Add error messages for invalid operations
- [ ] Handle edge cases (host not found, already subscribed, etc.)
- [ ] Update `/status` endpoint to show mode statistics

## Phase 7: Testing
- [ ] Create test script `testSubscription.js`
- [ ] Test host mode setup and broadcast
- [ ] Test guest subscription and message reception
- [ ] Test mode switching behavior
- [ ] Test cleanup on disconnect

## Phase 8: Documentation
- [ ] Update README.md with new message types
- [ ] Document host/guest mode usage
- [ ] Add examples for subscription and broadcast
- [ ] Update API documentation

## Implementation Details

### Connection Object Structure
```javascript
{
  ws: WebSocket,
  ip: string,
  shortToken: string,
  uuid: string,
  mode: 'host' | 'guest' | null,
  subscribedTo: string | null, // for guests
  subscribers: Set<string> // for hosts
}
```

### New Message Types to Handle
1. `set_mode` - Change client mode
2. `subscribe` - Subscribe to host channel
3. `unsubscribe` - Unsubscribe from current host
4. Broadcast detection - When `message.to === sender.shortToken`

### Key Functions to Implement
1. `handleSetMode(ws, message)` - Set client mode
2. `handleSubscribe(ws, message)` - Subscribe to host
3. `handleUnsubscribe(ws)` - Unsubscribe from host
4. `isBroadcastMessage(senderToken, targetToken)` - Check if message is broadcast
5. `sendBroadcast(hostToken, message)` - Send to all subscribers