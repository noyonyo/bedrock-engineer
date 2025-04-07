import React, { useEffect, useState, useCallback, useRef } from 'react'
import AILogo from '../../assets/images/icons/ai.svg'
import { MessageList } from './components/MessageList'
import InputFormContainer, { InputFormContainerRef } from './components/InputFormContainer'
import { ExampleScenarios } from './components/ExampleScenarios'
import { useAgentChat } from './hooks/useAgentChat'
import { AgentSelector } from './components/AgentSelector'
import useSetting from '@renderer/hooks/useSetting'
import useScroll from '@renderer/hooks/useScroll'
import { useIgnoreFileModal } from './modals/useIgnoreFileModal'
import { useToolSettingModal } from './modals/useToolSettingModal'
import { useAgentSettingsModal } from './modals/useAgentSettingsModal'
import { FiChevronRight } from 'react-icons/fi'
import { useTranslation } from 'react-i18next'
import { AttachedImage } from './components/InputForm/TextArea'
import { ChatHistory } from './components/ChatHistory'
import { useSystemPromptModal } from './modals/useSystemPromptModal'

export default function ChatPage() {
  // Remove userInput state (managed by InputFormContainer)
  const { t } = useTranslation()
  const {
    currentLLM: llm,
    projectPath,
    selectDirectory,
    sendMsgKey,
    selectedAgentId,
    setSelectedAgentId,
    agents,
    currentAgent,
    currentAgentSystemPrompt: systemPrompt
  } = useSetting()

  const currentScenarios = currentAgent?.scenarios || []
  const inputFormRef = useRef<InputFormContainerRef>(null)

  const {
    messages,
    loading,
    reasoning,
    handleSubmit,
    currentSessionId,
    setCurrentSessionId,
    clearChat,
    setMessages,
    stopGeneration
  } = useAgentChat(llm?.modelId, systemPrompt, selectedAgentId)

  // Memoize the submit handler with useCallback
  const onSubmit = useCallback(
    (input: string, images: AttachedImage[]) => {
      handleSubmit(input, images)
    },
    [handleSubmit]
  )

  // Removed handleUpdateMessage as the delete feature per ContentBlock is no longer needed

  // Create a copy of the message array
  const handleDeleteMessage = (index: number) => {
    // Create a copy of the message array
    const updatedMessages = [...messages]

    // Delete the message
    updatedMessages.splice(index, 1)

    // Set the updated message array
    setMessages(updatedMessages)

    // If chat history is enabled, delete the corresponding message
    if (currentSessionId) {
      window.chatHistory.deleteMessage(currentSessionId, index)
    }
  }

  const { scrollToBottom } = useScroll()
  const {
    show: showIgnoreFileModal,
    handleClose: handleCloseIgnoreFileModal,
    handleOpen: handleOpenIgnoreFileModal,
    IgnoreFileModal
  } = useIgnoreFileModal()

  const {
    show: showAgentSettingModal,
    handleOpen: openAgentSettingsModal,
    handleClose: handleCloseAgentSettingsModal,
    AgentSettingsModal
  } = useAgentSettingsModal()

  const {
    show: showSystemPromptModal,
    handleClose: handleCloseSystemPromptModal,
    handleOpen: handleOpenSystemPromptModal,
    SystemPromptModal
  } = useSystemPromptModal()

  const {
    show: showToolSettingModal,
    handleClose: handleCloseToolSettingModal,
    handleOpen: handleOpenToolSettingModal,
    ToolSettingModal
  } = useToolSettingModal()

  // Memoize the clear handler with useCallback
  const handleClearChat = useCallback(() => {
    if (window.confirm(t('confirmClearChat'))) {
      clearChat()
    }
  }, [clearChat, t])

  // Scenario selection handler
  const handleSelectScenario = useCallback((scenario: string) => {
    // Set the selected scenario in the text area
    if (inputFormRef.current) {
      inputFormRef.current.setInputText(scenario)
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [loading, messages.length])

  const [isHistoryOpen, setIsHistoryOpen] = useState(false)

  const handleSessionSelect = (sessionId: string) => {
    setCurrentSessionId(sessionId)
  }

  return (
    <React.Fragment>
      <div className="flex h-[calc(100vh-11rem)]">
        <div className="flex-1 flex flex-col">
          {/* Header - Fixed */}
          <div className="flex justify-between items-center">
            <AgentSelector
              agents={agents}
              selectedAgent={selectedAgentId}
              onOpenSettings={openAgentSettingsModal}
            />

            <div className="flex items-center gap-2">
              <span
                className="text-xs text-gray-400 font-thin cursor-pointer hover:text-gray-700 dark:hover:text-gray-300"
                onClick={handleOpenSystemPromptModal}
              >
                SYSTEM_PROMPT
              </span>
            </div>
          </div>

          {/* Modals */}
          <SystemPromptModal
            isOpen={showSystemPromptModal}
            onClose={handleCloseSystemPromptModal}
            systemPrompt={systemPrompt}
          />
          <AgentSettingsModal
            isOpen={showAgentSettingModal}
            onClose={handleCloseAgentSettingsModal}
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
          />
          <ToolSettingModal isOpen={showToolSettingModal} onClose={handleCloseToolSettingModal} />
          <IgnoreFileModal isOpen={showIgnoreFileModal} onClose={handleCloseIgnoreFileModal} />

          {/* Main content area - Flex grow */}
          <div className="flex flex-row flex-1 min-h-0">
            {/* Chat history side panel */}
            <div
              className={`dark:bg-gray-900 transition-all duration-300 ${
                isHistoryOpen ? 'w-96' : 'w-0'
              } overflow-y-auto`}
            >
              <ChatHistory
                onSessionSelect={handleSessionSelect}
                currentSessionId={currentSessionId}
              />
            </div>

            {/* Chat history toggle bar */}
            <div className="flex items-center">
              <div
                onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                className="w-4 h-16 dark:bg-gray-900 hover:dark:bg-gray-700 bg-gray-100 hover:bg-gray-200 cursor-pointer flex items-center justify-center transition-colors duration-200 rounded-lg m-2"
                title={t('Toggle chat history')}
              >
                <FiChevronRight
                  className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${
                    isHistoryOpen ? 'rotate-180' : ''
                  }`}
                />
              </div>
            </div>

            {/* Message area - Scrollable */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto mb-2">
                {messages.length === 0 ? (
                  <div className="flex flex-col pt-12 h-full w-full justify-center items-center content-center align-center gap-1">
                    <div className="flex flex-row gap-3 items-center mb-2">
                      <div className="h-6 w-6">
                        <AILogo />
                      </div>
                      <h1 className="text-lg font-bold dark:text-white">Agent Chat</h1>
                    </div>
                    <div className="text-gray-400">{t(currentAgent?.description ?? '')}</div>
                    {currentAgent && (
                      <ExampleScenarios
                        scenarios={currentScenarios}
                        onSelectScenario={handleSelectScenario}
                      />
                    )}
                  </div>
                ) : (
                  <div className="py-8">
                    <MessageList
                      messages={messages}
                      loading={loading}
                      reasoning={reasoning}
                      deleteMessage={handleDeleteMessage}
                    />
                  </div>
                )}
              </div>

              {/* Input form - Fixed */}
              <div className="mt-2 dark:border-gray-700 bg-white dark:bg-gray-800">
                <InputFormContainer
                  ref={inputFormRef}
                  loading={loading}
                  projectPath={projectPath}
                  sendMsgKey={sendMsgKey}
                  onSubmit={onSubmit}
                  onOpenToolSettings={handleOpenToolSettingModal}
                  onSelectDirectory={selectDirectory}
                  onOpenIgnoreModal={handleOpenIgnoreFileModal}
                  onClearChat={handleClearChat}
                  onStopGeneration={stopGeneration}
                  hasMessages={messages.length > 0}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </React.Fragment>
  )
}
