import Foundation
import PhotosUI
import Security
import UIKit
import UniformTypeIdentifiers

private struct ChatMessage: Codable {
    let role: String
    let content: String
    let source: String?
    let taskSummaries: [TaskSummary]?

    init(
        role: String,
        content: String,
        source: String? = nil,
        taskSummaries: [TaskSummary]? = nil
    ) {
        self.role = role
        self.content = content
        self.source = source
        self.taskSummaries = taskSummaries
    }
}

/// 관제 대시보드가 규칙 엔진에서 확정한 작업 목록입니다.
/// 문장형 AI 답변과 분리하여 iPhone에서도 표 형태로 안전하게 보여 줍니다.
private struct TaskSummary: Codable {
    let workerId: String
    let blockedTags: [String]
    let allowedTags: [String]
    let pendingTags: [String]
}

private struct AssignmentChatContract: Decodable {
    let version: String
    let welcomeMessage: String
    let suggestions: [String]
    let inputPlaceholder: String
    let requestLabel: String
    let loadingMessage: String
    let genericError: String
    let sessionExpired: String
    let disclaimer: String

    static let fallback = AssignmentChatContract(
        version: "fallback",
        welcomeMessage: "작업자 사번(EMP-…)을 포함해 질문해 주세요.\n예: \"EMP-6861 오늘 고소작업 배치 가능해?\"\n등급·배제 권고는 최근 24시간 워치 실측 기반의 안전 기준 참고 정보입니다.",
        suggestions: [],
        inputPlaceholder: "질문을 입력하세요",
        requestLabel: "질문",
        loadingMessage: "판정 조회 중…",
        genericError: "응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        sessionExpired: "로그인 세션이 만료되었습니다. 잠시 후 로그인 화면으로 이동합니다.",
        disclaimer: "본 등급은 안전 기준 참고 정보이며 의료적 판단이 아닙니다. 최종 배치 결정 권한은 감독관에게 있습니다."
    )
}

private struct AssignmentChatResponse: Decodable {
    let ok: Bool
    let reply: String?
    let source: String?
    let disclaimer: String?
    let error: String?
    let assignments: [Assignment]?
    let taskSummaries: [TaskSummary]?

    struct Assignment: Decodable { let workerId: String }
}

private enum AssistantAttachmentKind: String {
    case photo
    case video
    case file

    var symbol: String {
        switch self {
        case .photo: return "photo.fill"
        case .video: return "video.fill"
        case .file: return "doc.fill"
        }
    }

    var title: String {
        switch self {
        case .photo: return "사진"
        case .video: return "동영상"
        case .file: return "파일"
        }
    }
}

private struct AssistantAttachment: Identifiable {
    let id = UUID()
    let kind: AssistantAttachmentKind
    let displayName: String
}

private enum AssistantProvider: Int, CaseIterable {
    case openAI
    case hyperCLOVA

    var title: String {
        switch self {
        case .openAI: return "OpenAI"
        case .hyperCLOVA: return "HyperCLOVA"
        }
    }

    var keychainAccount: String {
        switch self {
        case .openAI: return "openai-api-key"
        case .hyperCLOVA: return "hyperclova-api-key"
        }
    }

    var keyPlaceholder: String {
        "\(title) API 키 입력"
    }
}

private enum VitAlGuardAssistantKeychain {
    static let service = "com.yangjeehoo.vitalguard.assistant"

    private static func accountQuery(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    static func save(_ value: String, for provider: AssistantProvider) throws {
        let data = Data(value.utf8)
        var keyQuery = accountQuery(provider.keychainAccount)
        SecItemDelete(keyQuery as CFDictionary)
        keyQuery[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        keyQuery[kSecAttrSynchronizable as String] = kCFBooleanFalse
        keyQuery[kSecValueData as String] = data

        let status = SecItemAdd(keyQuery as CFDictionary, nil)
        if status != errSecSuccess {
            throw AssistantError.keychainSaveFailed(status)
        }
    }

    static func load(_ provider: AssistantProvider) -> String? {
        queryKey(accountQuery(provider.keychainAccount))
    }

    private static func queryKey(_ query: [String: Any]) -> String? {
        var keyQuery: [String: Any] = query
        keyQuery[kSecReturnData as String] = true
        keyQuery[kSecMatchLimit as String] = kSecMatchLimitOne
        keyQuery[kSecReturnAttributes as String] = false
        keyQuery[kSecAttrSynchronizable as String] = kSecAttrSynchronizableAny

        var raw: CFTypeRef?
        let status = SecItemCopyMatching(keyQuery as CFDictionary, &raw)
        guard status == errSecSuccess else {
            if status == errSecItemNotFound { return nil }
            return nil
        }
        guard let data = raw as? Data, let value = String(data: data, encoding: .utf8) else { return nil }
        return value
    }

    static func remove(_ provider: AssistantProvider) throws {
        let keyQuery = accountQuery(provider.keychainAccount)
        let status = SecItemDelete(keyQuery as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw AssistantError.keychainDeleteFailed(status)
        }
    }

    static func removeLegacyProviderKeys() {
        AssistantProvider.allCases.forEach { provider in
            try? remove(provider)
        }
    }
}

final class VitAlGuardAssistantViewController: UIViewController, UITextViewDelegate, PHPickerViewControllerDelegate, UIDocumentPickerDelegate {
    var onCloseRequest: (() -> Void)?

    private let usageBar = UIView()
    private let usageLabel = UILabel()
    private let usageTokenLabel = UILabel()
    private let keyField = UITextField()
    private let providerControl = UISegmentedControl(items: ["OpenAI", "HyperCLOVA"])
    private let statusLabel = UILabel()
    private let systemInfoLabel = UILabel()
    private let messagesStack = UIStackView()
    private weak var rootScrollView: UIScrollView?
    private let inputField = UITextView()
    private let sendButton = UIButton(type: .system)
    private let attachmentButton = UIButton(type: .system)
    private let attachmentTray = UIView()
    private let attachmentScrollView = UIScrollView()
    private let attachmentStack = UIStackView()
    private let messageEditButton = UIButton(type: .system)
    private let messageEditToolbar = UIStackView()
    private let selectAllMessagesButton = UIButton(type: .system)
    private let deleteSelectedMessagesButton = UIButton(type: .system)
    private let finishMessageEditButton = UIButton(type: .system)
    private let saveButton = UIButton(type: .system)
    private let clearButton = UIButton(type: .system)
    private let deleteButton = UIButton(type: .system)
    private let refreshButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let apiKeyButton = UIButton(type: .system)
    private let keySettingsCard = UIView()
    private let messagesContentView = UIView()
    private var keySettingsHeightConstraint: NSLayoutConstraint?
    private var attachmentTrayHeightConstraint: NSLayoutConstraint?
    private var messageEditToolbarHeightConstraint: NSLayoutConstraint?
    private let keySettingsExpandedHeight: CGFloat = 184

    private var messages: [ChatMessage] = []
    private var requestCount = 0
    private var totalPromptTokens = 0
    private var totalCompletionTokens = 0
    private var totalTokens = 0
    private let messageInputContainer = UIView()
    private var pendingAttachments: [AssistantAttachment] = []
    private var chatContract = AssignmentChatContract.fallback
    private var followUpWorkerIds: [String] = []
    private var isMessageEditMode = false
    private var selectedMessageIndexes = Set<Int>()
    private var activeProvider: AssistantProvider {
        providerControl.selectedSegmentIndex == AssistantProvider.openAI.rawValue ? .openAI : .hyperCLOVA
    }
    private let systemPrompt = """
    당신은 VitAlGuard 앱의 안전 보조 챗봇입니다.
    역할: 낙상 대응, 응급 상황, 건강/안전 질문에 대해 침착하고 간결한 가이드 제공.
    의료 진단·처방·법적 판단은 하지 마세요.
    위험 신호가 의심되면 즉시 119 또는 지역 응급 구조에 연락하라고 안내하세요.
    질문에 대해 1~3문단 이하로 짧게 설명하고, 과장된 확신은 피하세요.
    """

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.systemBackground
        title = "VitAlGuard 챗봇"
        navigationItem.title = ""

        configureUI()
        VitAlGuardAssistantKeychain.removeLegacyProviderKeys()
        loadSavedState()
        seedMessagesIfNeeded()
        apiKeyButton.isHidden = true
        setKeySettingsVisible(false, animated: false)
        Task { await refreshChatContract() }
    }

    private func configureUI() {
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.keyboardDismissMode = .onDrag
        view.addSubview(scroll)
        rootScrollView = scroll

        setupUsageBar()
        view.addSubview(usageBar)

        setupKeySettingsCard()
        view.addSubview(keySettingsCard)

        keyField.borderStyle = .roundedRect
        keyField.isSecureTextEntry = true
        keyField.textContentType = .password
        keyField.autocapitalizationType = .none
        keyField.autocorrectionType = .no
        keyField.clearButtonMode = .whileEditing

        var saveConfig = UIButton.Configuration.filled()
        saveConfig.title = "저장"
        saveConfig.baseBackgroundColor = .systemBlue
        saveConfig.baseForegroundColor = .white
        saveConfig.contentInsets = NSDirectionalEdgeInsets(top: 11, leading: 14, bottom: 11, trailing: 14)
        saveButton.configuration = saveConfig
        saveButton.addTarget(self, action: #selector(saveKeyTapped), for: .touchUpInside)
        saveButton.layer.cornerRadius = 10

        var deleteConfig = UIButton.Configuration.filled()
        deleteConfig.image = UIImage(systemName: "trash")
        deleteConfig.baseBackgroundColor = .systemRed
        deleteConfig.baseForegroundColor = .white
        deleteConfig.contentInsets = NSDirectionalEdgeInsets(top: 11, leading: 14, bottom: 11, trailing: 14)
        deleteButton.configuration = deleteConfig
        deleteButton.addTarget(self, action: #selector(deleteKeyTapped), for: .touchUpInside)
        deleteButton.layer.cornerRadius = 10

        refreshButton.setImage(UIImage(systemName: "arrow.clockwise"), for: .normal)
        refreshButton.tintColor = .systemGray
        refreshButton.addTarget(self, action: #selector(refreshConversationTapped), for: .touchUpInside)
        refreshButton.translatesAutoresizingMaskIntoConstraints = false
        refreshButton.setContentHuggingPriority(.required, for: .horizontal)
        refreshButton.widthAnchor.constraint(equalToConstant: 36).isActive = true

        apiKeyButton.setImage(UIImage(systemName: "key.fill"), for: .normal)
        apiKeyButton.tintColor = .systemBlue
        apiKeyButton.addTarget(self, action: #selector(focusAPIKeyTapped), for: .touchUpInside)
        apiKeyButton.translatesAutoresizingMaskIntoConstraints = false
        apiKeyButton.setContentHuggingPriority(.required, for: .horizontal)
        apiKeyButton.widthAnchor.constraint(equalToConstant: 36).isActive = true

        messageEditButton.setImage(UIImage(systemName: "checklist"), for: .normal)
        messageEditButton.tintColor = .systemBlue
        messageEditButton.accessibilityLabel = "채팅 내역 선택 및 삭제"
        messageEditButton.addTarget(self, action: #selector(messageEditTapped), for: .touchUpInside)
        messageEditButton.translatesAutoresizingMaskIntoConstraints = false
        messageEditButton.setContentHuggingPriority(.required, for: .horizontal)
        messageEditButton.widthAnchor.constraint(equalToConstant: 36).isActive = true

        closeButton.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
        closeButton.tintColor = .label
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.setContentHuggingPriority(.required, for: .horizontal)
        closeButton.widthAnchor.constraint(equalToConstant: 36).isActive = true

        statusLabel.textColor = .secondaryLabel
        statusLabel.font = .systemFont(ofSize: 12)
        statusLabel.numberOfLines = 2
        statusLabel.lineBreakMode = .byWordWrapping
        statusLabel.text = "저장된 키가 없습니다."

        systemInfoLabel.text = "API 키는 이 기기의 Keychain에만 저장됩니다. 한 제공자 키만 있어도 대화를 시작할 수 있습니다."
        systemInfoLabel.textColor = .secondaryLabel
        systemInfoLabel.numberOfLines = 2
        systemInfoLabel.lineBreakMode = .byWordWrapping
        systemInfoLabel.font = .systemFont(ofSize: 12)

        let keyRow = UIStackView(arrangedSubviews: [keyField, saveButton, deleteButton])
        keyRow.spacing = 8
        keyRow.translatesAutoresizingMaskIntoConstraints = false

        messagesStack.axis = .vertical
        messagesStack.spacing = 8
        messagesStack.translatesAutoresizingMaskIntoConstraints = false

        inputField.backgroundColor = UIColor.systemBackground
        inputField.font = .systemFont(ofSize: 17)
        inputField.textColor = .placeholderText
        inputField.text = "메시지"
        inputField.accessibilityLabel = "메시지 입력"
        inputField.delegate = self
        inputField.layer.cornerRadius = 21
        inputField.layer.masksToBounds = true
        inputField.layer.borderWidth = 1 / UIScreen.main.scale
        inputField.layer.borderColor = UIColor.separator.withAlphaComponent(0.45).cgColor
        inputField.textContainerInset = UIEdgeInsets(top: 10, left: 14, bottom: 10, right: 14)
        inputField.isScrollEnabled = false
        inputField.translatesAutoresizingMaskIntoConstraints = false
        attachmentButton.setImage(UIImage(systemName: "plus.circle.fill"), for: .normal)
        attachmentButton.tintColor = .systemBlue
        attachmentButton.accessibilityLabel = "사진, 동영상 또는 파일 첨부"
        attachmentButton.translatesAutoresizingMaskIntoConstraints = false
        attachmentButton.addTarget(self, action: #selector(attachmentTapped), for: .touchUpInside)
        var sendConfig = UIButton.Configuration.filled()
        sendConfig.image = UIImage(systemName: "arrow.up")
        sendConfig.baseBackgroundColor = .systemBlue
        sendConfig.baseForegroundColor = .white
        sendConfig.contentInsets = NSDirectionalEdgeInsets(top: 11, leading: 16, bottom: 11, trailing: 16)
        sendButton.configuration = sendConfig
        sendButton.accessibilityLabel = "메시지 전송"
        sendButton.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)
        sendButton.translatesAutoresizingMaskIntoConstraints = false
        sendButton.tintColor = .white
        sendButton.layer.cornerRadius = 20

        var clearConfig = UIButton.Configuration.filled()
        clearConfig.title = "채팅 초기화"
        clearConfig.baseBackgroundColor = .systemGray
        clearConfig.baseForegroundColor = .white
        clearConfig.contentInsets = NSDirectionalEdgeInsets(top: 11, leading: 14, bottom: 11, trailing: 14)
        clearButton.configuration = clearConfig
        clearButton.addTarget(self, action: #selector(clearTapped), for: .touchUpInside)
        clearButton.layer.cornerRadius = 10

        messageInputContainer.translatesAutoresizingMaskIntoConstraints = false
        messageInputContainer.backgroundColor = UIColor.secondarySystemBackground
        messageInputContainer.layer.cornerRadius = 0
        messageInputContainer.layer.borderWidth = 1 / UIScreen.main.scale
        messageInputContainer.layer.borderColor = UIColor.separator.withAlphaComponent(0.55).cgColor
        view.addSubview(messageInputContainer)
        messageInputContainer.addSubview(attachmentButton)
        messageInputContainer.addSubview(inputField)
        messageInputContainer.addSubview(sendButton)

        NSLayoutConstraint.activate([
            attachmentButton.leadingAnchor.constraint(equalTo: messageInputContainer.leadingAnchor, constant: 12),
            attachmentButton.centerYAnchor.constraint(equalTo: messageInputContainer.centerYAnchor),
            attachmentButton.widthAnchor.constraint(equalToConstant: 32),
            attachmentButton.heightAnchor.constraint(equalToConstant: 32),
            inputField.leadingAnchor.constraint(equalTo: attachmentButton.trailingAnchor, constant: 8),
            inputField.trailingAnchor.constraint(equalTo: sendButton.leadingAnchor, constant: -8),
            inputField.topAnchor.constraint(equalTo: messageInputContainer.topAnchor, constant: 12),
            inputField.bottomAnchor.constraint(equalTo: messageInputContainer.bottomAnchor, constant: -12),
            sendButton.trailingAnchor.constraint(equalTo: messageInputContainer.trailingAnchor, constant: -16),
            sendButton.centerYAnchor.constraint(equalTo: messageInputContainer.centerYAnchor),
            sendButton.widthAnchor.constraint(equalToConstant: 40),
            sendButton.heightAnchor.constraint(equalToConstant: 40)
        ])

        let keyContent = UIStackView(arrangedSubviews: [providerControl, keyRow, statusLabel, systemInfoLabel])
        keyContent.axis = .vertical
        keyContent.spacing = 8
        keyContent.translatesAutoresizingMaskIntoConstraints = false
        keySettingsCard.addSubview(keyContent)

        messagesContentView.translatesAutoresizingMaskIntoConstraints = false
        messagesContentView.backgroundColor = UIColor.clear
        scroll.addSubview(messagesContentView)
        messagesContentView.addSubview(messagesStack)

        attachmentTray.translatesAutoresizingMaskIntoConstraints = false
        attachmentTray.backgroundColor = UIColor.secondarySystemBackground
        attachmentTray.isHidden = true
        view.addSubview(attachmentTray)

        attachmentScrollView.translatesAutoresizingMaskIntoConstraints = false
        attachmentScrollView.showsHorizontalScrollIndicator = false
        attachmentTray.addSubview(attachmentScrollView)

        attachmentStack.translatesAutoresizingMaskIntoConstraints = false
        attachmentStack.axis = .horizontal
        attachmentStack.spacing = 8
        attachmentStack.alignment = .center
        attachmentScrollView.addSubview(attachmentStack)

        configureMessageEditToolbar()
        view.addSubview(messageEditToolbar)

        NSLayoutConstraint.activate([
            keyField.heightAnchor.constraint(equalToConstant: 42),
            saveButton.widthAnchor.constraint(equalToConstant: 62),
            deleteButton.widthAnchor.constraint(equalToConstant: 42),
            deleteButton.heightAnchor.constraint(equalTo: keyField.heightAnchor),
            inputField.heightAnchor.constraint(greaterThanOrEqualToConstant: 42),
            inputField.heightAnchor.constraint(lessThanOrEqualToConstant: 100)
        ])

        NSLayoutConstraint.activate([
            usageBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            usageBar.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            usageBar.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            keySettingsCard.topAnchor.constraint(equalTo: usageBar.bottomAnchor, constant: 8),
            keySettingsCard.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            keySettingsCard.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: keySettingsCard.bottomAnchor, constant: 4),
            scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: messageEditToolbar.topAnchor),
            messagesContentView.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 12),
            messagesContentView.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 14),
            messagesContentView.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -14),
            messagesContentView.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -12),
            messagesContentView.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -28),
            messagesStack.topAnchor.constraint(equalTo: messagesContentView.topAnchor),
            messagesStack.leadingAnchor.constraint(equalTo: messagesContentView.leadingAnchor),
            messagesStack.trailingAnchor.constraint(equalTo: messagesContentView.trailingAnchor),
            messagesStack.bottomAnchor.constraint(equalTo: messagesContentView.bottomAnchor),
            attachmentTray.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            attachmentTray.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            messageEditToolbar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            messageEditToolbar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            messageEditToolbar.bottomAnchor.constraint(equalTo: attachmentTray.topAnchor),
            attachmentTray.bottomAnchor.constraint(equalTo: messageInputContainer.topAnchor),
            attachmentScrollView.topAnchor.constraint(equalTo: attachmentTray.topAnchor, constant: 6),
            attachmentScrollView.leadingAnchor.constraint(equalTo: attachmentTray.leadingAnchor, constant: 12),
            attachmentScrollView.trailingAnchor.constraint(equalTo: attachmentTray.trailingAnchor, constant: -12),
            attachmentScrollView.bottomAnchor.constraint(equalTo: attachmentTray.bottomAnchor, constant: -6),
            attachmentStack.topAnchor.constraint(equalTo: attachmentScrollView.contentLayoutGuide.topAnchor),
            attachmentStack.leadingAnchor.constraint(equalTo: attachmentScrollView.contentLayoutGuide.leadingAnchor),
            attachmentStack.trailingAnchor.constraint(equalTo: attachmentScrollView.contentLayoutGuide.trailingAnchor),
            attachmentStack.bottomAnchor.constraint(equalTo: attachmentScrollView.contentLayoutGuide.bottomAnchor),
            attachmentStack.heightAnchor.constraint(equalTo: attachmentScrollView.frameLayoutGuide.heightAnchor),
            messageInputContainer.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            messageInputContainer.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            // Tracks the real keyboard frame, including Korean/third-party keyboards.
            messageInputContainer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            messageInputContainer.heightAnchor.constraint(equalToConstant: 66)
        ])

        attachmentTrayHeightConstraint = attachmentTray.heightAnchor.constraint(equalToConstant: 0)
        attachmentTrayHeightConstraint?.isActive = true
        messageEditToolbarHeightConstraint = messageEditToolbar.heightAnchor.constraint(equalToConstant: 0)
        messageEditToolbarHeightConstraint?.isActive = true

        view.bringSubviewToFront(attachmentTray)
        view.bringSubviewToFront(messageInputContainer)

        keySettingsHeightConstraint = keySettingsCard.heightAnchor.constraint(equalToConstant: keySettingsExpandedHeight)
        keySettingsHeightConstraint?.isActive = true
        NSLayoutConstraint.activate([
            keyContent.topAnchor.constraint(equalTo: keySettingsCard.topAnchor, constant: 12),
            keyContent.leadingAnchor.constraint(equalTo: keySettingsCard.leadingAnchor, constant: 12),
            keyContent.trailingAnchor.constraint(equalTo: keySettingsCard.trailingAnchor, constant: -12),
            keyContent.bottomAnchor.constraint(equalTo: keySettingsCard.bottomAnchor, constant: -12)
        ])
    }

    private func setupKeySettingsCard() {
        keySettingsCard.translatesAutoresizingMaskIntoConstraints = false
        keySettingsCard.backgroundColor = UIColor.secondarySystemBackground
        keySettingsCard.layer.cornerRadius = 18
        keySettingsCard.layer.borderWidth = 1
        keySettingsCard.layer.borderColor = UIColor.separator.withAlphaComponent(0.4).cgColor

        providerControl.selectedSegmentIndex = AssistantProvider.hyperCLOVA.rawValue
        providerControl.addTarget(self, action: #selector(providerChanged), for: .valueChanged)
        providerControl.selectedSegmentTintColor = .systemBlue
        providerControl.setTitleTextAttributes([.foregroundColor: UIColor.white], for: .selected)
        updateProviderField()
    }

    private func setupUsageBar() {
        usageBar.translatesAutoresizingMaskIntoConstraints = false
        usageBar.layer.cornerRadius = 14
        usageBar.backgroundColor = UIColor.secondarySystemBackground
        usageBar.layer.borderWidth = 1
        usageBar.layer.borderColor = UIColor.separator.withAlphaComponent(0.35).cgColor
        usageBar.layer.shadowColor = UIColor.black.withAlphaComponent(0.08).cgColor
        usageBar.layer.shadowOpacity = 0.12
        usageBar.layer.shadowRadius = 8
        usageBar.layer.shadowOffset = CGSize(width: 0, height: 1)

        let topControlRow = UIStackView()
        topControlRow.translatesAutoresizingMaskIntoConstraints = false
        topControlRow.axis = .horizontal
        topControlRow.alignment = .center
        topControlRow.spacing = 8
        topControlRow.distribution = .fill

        let actionRow = UIStackView()
        actionRow.translatesAutoresizingMaskIntoConstraints = false
        actionRow.axis = .horizontal
        actionRow.alignment = .center
        actionRow.spacing = 8
        actionRow.distribution = .equalSpacing

        usageLabel.text = "HyperCLOVA · 요청 0건"
        usageLabel.font = .systemFont(ofSize: 13, weight: .medium)
        usageLabel.textColor = .secondaryLabel
        usageLabel.numberOfLines = 1
        usageLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        usageLabel.adjustsFontForContentSizeCategory = true

        usageTokenLabel.text = ""
        usageTokenLabel.font = .systemFont(ofSize: 11, weight: .regular)
        usageTokenLabel.textColor = .tertiaryLabel
        usageTokenLabel.numberOfLines = 1
        usageTokenLabel.adjustsFontForContentSizeCategory = true

        let titleLabel = UILabel()
        titleLabel.text = "VitAlGuard 챗봇"
        titleLabel.font = .systemFont(ofSize: 17, weight: .bold)
        titleLabel.textAlignment = .center
        titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let usageTextRow = UIStackView(arrangedSubviews: [titleLabel, usageLabel, usageTokenLabel])
        usageTextRow.axis = .vertical
        usageTextRow.alignment = .leading
        usageTextRow.spacing = 4
        usageTextRow.translatesAutoresizingMaskIntoConstraints = false

        let spacer = UIView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        spacer.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        actionRow.addArrangedSubview(messageEditButton)
        actionRow.addArrangedSubview(apiKeyButton)
        actionRow.addArrangedSubview(refreshButton)

        topControlRow.addArrangedSubview(closeButton)
        topControlRow.addArrangedSubview(spacer)
        topControlRow.addArrangedSubview(actionRow)

        usageBar.addSubview(topControlRow)
        usageBar.addSubview(usageTextRow)
        NSLayoutConstraint.activate([
            topControlRow.topAnchor.constraint(equalTo: usageBar.topAnchor, constant: 8),
            topControlRow.leadingAnchor.constraint(equalTo: usageBar.leadingAnchor, constant: 10),
            topControlRow.trailingAnchor.constraint(equalTo: usageBar.trailingAnchor, constant: -10),
            usageTextRow.topAnchor.constraint(equalTo: topControlRow.bottomAnchor, constant: 4),
            usageTextRow.leadingAnchor.constraint(equalTo: usageBar.leadingAnchor, constant: 10),
            usageTextRow.trailingAnchor.constraint(equalTo: usageBar.trailingAnchor, constant: -10),
            usageTextRow.bottomAnchor.constraint(equalTo: usageBar.bottomAnchor, constant: -8)
        ])

        NSLayoutConstraint.activate([
            closeButton.heightAnchor.constraint(equalToConstant: 36),
            messageEditButton.heightAnchor.constraint(equalToConstant: 36),
            apiKeyButton.heightAnchor.constraint(equalToConstant: 36),
            refreshButton.heightAnchor.constraint(equalToConstant: 36),
            closeButton.widthAnchor.constraint(equalToConstant: 36),
            messageEditButton.widthAnchor.constraint(equalToConstant: 36),
            apiKeyButton.widthAnchor.constraint(equalToConstant: 36),
            refreshButton.widthAnchor.constraint(equalToConstant: 36),
            topControlRow.heightAnchor.constraint(greaterThanOrEqualToConstant: 36)
        ])

        [messageEditButton, apiKeyButton, refreshButton, closeButton].forEach { button in
            button.backgroundColor = UIColor.systemBlue.withAlphaComponent(0.1)
            button.layer.cornerRadius = 18
            button.clipsToBounds = true
            button.setContentCompressionResistancePriority(.required, for: .horizontal)
        }
    }

    private func configureMessageEditToolbar() {
        messageEditToolbar.translatesAutoresizingMaskIntoConstraints = false
        messageEditToolbar.axis = .horizontal
        messageEditToolbar.alignment = .center
        messageEditToolbar.spacing = 8
        messageEditToolbar.distribution = .fill
        messageEditToolbar.backgroundColor = UIColor.secondarySystemBackground
        messageEditToolbar.layer.cornerRadius = 14
        messageEditToolbar.isHidden = true

        selectAllMessagesButton.setTitle("전체 선택", for: .normal)
        selectAllMessagesButton.addTarget(self, action: #selector(selectAllMessagesTapped), for: .touchUpInside)
        selectAllMessagesButton.setContentHuggingPriority(.required, for: .horizontal)

        deleteSelectedMessagesButton.setTitle("선택 삭제", for: .normal)
        deleteSelectedMessagesButton.setTitleColor(.systemRed, for: .normal)
        deleteSelectedMessagesButton.addTarget(self, action: #selector(deleteSelectedMessagesTapped), for: .touchUpInside)
        deleteSelectedMessagesButton.setContentHuggingPriority(.required, for: .horizontal)

        finishMessageEditButton.setTitle("완료", for: .normal)
        finishMessageEditButton.addTarget(self, action: #selector(messageEditTapped), for: .touchUpInside)
        finishMessageEditButton.setContentHuggingPriority(.required, for: .horizontal)

        let spacer = UIView()
        messageEditToolbar.addArrangedSubview(selectAllMessagesButton)
        messageEditToolbar.addArrangedSubview(spacer)
        messageEditToolbar.addArrangedSubview(deleteSelectedMessagesButton)
        messageEditToolbar.addArrangedSubview(finishMessageEditButton)
        updateMessageEditControls()
    }

    private func makeSeparator() -> UIView {
        let bar = UIView()
        bar.backgroundColor = UIColor.separator
        bar.heightAnchor.constraint(equalToConstant: 1).isActive = true
        return bar
    }

    private func makeSectionTitle(_ text: String) -> UILabel {
        let label = UILabel()
        label.font = .boldSystemFont(ofSize: 16)
        label.text = text
        return label
    }

    private func makeMessageBubble(_ message: ChatMessage, index: Int) -> UIView {
        let isUser = message.role == "user"
        let isSystem = message.role == "system"

        let row = UIStackView()
        row.axis = .horizontal
        row.alignment = .top
        row.spacing = 6
        row.translatesAutoresizingMaskIntoConstraints = false

        let bubbleContainer = UIView()
        bubbleContainer.translatesAutoresizingMaskIntoConstraints = false
        bubbleContainer.layer.cornerRadius = 16
        bubbleContainer.layer.masksToBounds = true
        bubbleContainer.backgroundColor = isUser
            ? UIColor.systemBlue
            : (isSystem ? UIColor.systemGray5 : UIColor.systemGray3)
        if isUser {
            if #available(iOS 11.0, *) {
                bubbleContainer.layer.maskedCorners = [
                    .layerMinXMaxYCorner,
                    .layerMinXMinYCorner,
                    .layerMaxXMinYCorner
                ]
            }
        } else {
            if #available(iOS 11.0, *) {
                bubbleContainer.layer.maskedCorners = [
                    .layerMinXMaxYCorner,
                    .layerMaxXMaxYCorner,
                    .layerMaxXMinYCorner
                ]
            }
        }

        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.numberOfLines = 0
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.text = message.content
        label.textColor = isUser ? .white : .label

        let bubbleContent = UIStackView()
        bubbleContent.translatesAutoresizingMaskIntoConstraints = false
        bubbleContent.axis = .vertical
        bubbleContent.alignment = .fill
        bubbleContent.spacing = 8
        bubbleContent.addArrangedSubview(label)
        if !isUser, let taskSummaries = message.taskSummaries, !taskSummaries.isEmpty {
            bubbleContent.addArrangedSubview(makeTaskSummaryTable(taskSummaries))
        }
        if !isUser, let source = message.source {
            let sourceLabel = UILabel()
            sourceLabel.font = .preferredFont(forTextStyle: .caption2)
            sourceLabel.adjustsFontForContentSizeCategory = true
            sourceLabel.textColor = .secondaryLabel
            sourceLabel.text = source == "clova" ? "HyperCLOVA X · 판정은 규칙 엔진" : "규칙 엔진 응답"
            bubbleContent.addArrangedSubview(sourceLabel)
        }

        bubbleContainer.addSubview(bubbleContent)
        NSLayoutConstraint.activate([
            bubbleContent.topAnchor.constraint(equalTo: bubbleContainer.topAnchor, constant: 10),
            bubbleContent.bottomAnchor.constraint(equalTo: bubbleContainer.bottomAnchor, constant: -10),
            bubbleContent.leadingAnchor.constraint(equalTo: bubbleContainer.leadingAnchor, constant: 12),
            bubbleContent.trailingAnchor.constraint(equalTo: bubbleContainer.trailingAnchor, constant: -12)
        ])

        let leftSpacer = UIView()
        let rightSpacer = UIView()
        leftSpacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        rightSpacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        leftSpacer.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        rightSpacer.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        if isUser {
            row.addArrangedSubview(leftSpacer)
            row.addArrangedSubview(bubbleContainer)
        } else {
            row.addArrangedSubview(bubbleContainer)
            row.addArrangedSubview(rightSpacer)
        }

        NSLayoutConstraint.activate([
            bubbleContainer.widthAnchor.constraint(lessThanOrEqualToConstant: UIScreen.main.bounds.width * 0.78)
        ])

        guard isMessageEditMode else { return row }

        let selectionButton = UIButton(type: .system)
        selectionButton.translatesAutoresizingMaskIntoConstraints = false
        selectionButton.tag = index
        selectionButton.setImage(
            UIImage(systemName: selectedMessageIndexes.contains(index) ? "checkmark.circle.fill" : "circle"),
            for: .normal
        )
        selectionButton.tintColor = .systemBlue
        selectionButton.accessibilityLabel = "\(index + 1)번째 메시지 선택"
        selectionButton.addTarget(self, action: #selector(toggleMessageSelection(_:)), for: .touchUpInside)
        selectionButton.widthAnchor.constraint(equalToConstant: 30).isActive = true

        let editableRow = UIStackView(arrangedSubviews: [selectionButton, row])
        editableRow.axis = .horizontal
        editableRow.alignment = .top
        editableRow.spacing = 6
        editableRow.translatesAutoresizingMaskIntoConstraints = false
        return editableRow
    }

    private func makeTaskSummaryTable(_ summaries: [TaskSummary]) -> UIView {
        let table = UIStackView()
        table.axis = .vertical
        table.spacing = 0
        table.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.64)
        table.layer.cornerRadius = 10
        table.layer.masksToBounds = true

        let title = UILabel()
        title.font = .preferredFont(forTextStyle: .caption1)
        title.adjustsFontForContentSizeCategory = true
        title.textColor = .label
        title.text = "서버 판정 작업 목록"
        let titleContainer = UIView()
        titleContainer.backgroundColor = UIColor.separator.withAlphaComponent(0.16)
        titleContainer.addSubview(title)
        title.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: titleContainer.topAnchor, constant: 6),
            title.bottomAnchor.constraint(equalTo: titleContainer.bottomAnchor, constant: -6),
            title.leadingAnchor.constraint(equalTo: titleContainer.leadingAnchor, constant: 8),
            title.trailingAnchor.constraint(equalTo: titleContainer.trailingAnchor, constant: -8)
        ])
        table.addArrangedSubview(titleContainer)

        for summary in summaries {
            let row = UIStackView()
            row.axis = .vertical
            row.spacing = 3
            row.isLayoutMarginsRelativeArrangement = true
            row.layoutMargins = UIEdgeInsets(top: 7, left: 8, bottom: 7, right: 8)

            let worker = UILabel()
            worker.font = .preferredFont(forTextStyle: .caption1)
            worker.adjustsFontForContentSizeCategory = true
            worker.textColor = .label
            worker.text = summary.workerId
            row.addArrangedSubview(worker)

            addTaskSummaryRow("배제 권고", values: summary.blockedTags, to: row)
            addTaskSummaryRow("배치 가능", values: summary.allowedTags, to: row)
            addTaskSummaryRow("판단 보류", values: summary.pendingTags, to: row)
            table.addArrangedSubview(row)
        }
        return table
    }

    private func addTaskSummaryRow(_ title: String, values: [String], to stack: UIStackView) {
        guard !values.isEmpty else { return }
        let row = UILabel()
        row.font = .preferredFont(forTextStyle: .caption2)
        row.adjustsFontForContentSizeCategory = true
        row.numberOfLines = 0
        row.textColor = .secondaryLabel
        row.text = "\(title)  \(values.joined(separator: ", "))"
        stack.addArrangedSubview(row)
    }

    private func seedMessagesIfNeeded() {
        if messages.isEmpty {
            messages.append(
                ChatMessage(
                    role: "system",
                    content: chatContract.welcomeMessage
                )
            )
            rebuildMessageBubbles()
        }
    }

    private func rebuildMessageBubbles() {
        messagesStack.arrangedSubviews.forEach { view in
            messagesStack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }

        for (index, message) in messages.enumerated() {
            messagesStack.addArrangedSubview(makeMessageBubble(message, index: index))
        }

        scrollToBottomOfChat()
    }

    private func scrollToBottomOfChat() {
        guard let scroll = rootScrollView else { return }
        DispatchQueue.main.async {
            let maxOffsetY = max(0, scroll.contentSize.height - scroll.bounds.height)
            if maxOffsetY > 0 {
                scroll.setContentOffset(CGPoint(x: 0, y: maxOffsetY), animated: true)
            }
        }
    }

    private func updateUsageLabel() {
        let tokenText = totalTokens > 0
            ? " / 토큰: 총 \(totalTokens)"
            : ""
        usageLabel.text = "관제 서버 · 요청 \(requestCount)건"
        if tokenText.isEmpty {
            usageTokenLabel.text = "최근 응답 토큰: 없음"
        } else {
            usageTokenLabel.text = "최근 응답 토큰: 총 \(totalTokens)"
        }
    }

    private func loadSavedState() {
        statusLabel.text = vitalGuardAssistantSessionToken().isEmpty
            ? "관제 계정 로그인이 필요합니다."
            : "관제 서버의 안전 어시스턴트에 연결됩니다."
        setKeySettingsVisible(false, animated: false)
        updateUsageLabel()
    }

    private func appendLog(
        _ role: String,
        text: String,
        source: String? = nil,
        taskSummaries: [TaskSummary]? = nil
    ) {
        let marker: String
        if role == "user" {
            marker = "user"
        } else if role == "assistant" {
            marker = "assistant"
        } else {
            marker = "system"
        }
        messages.append(ChatMessage(role: marker, content: text, source: source, taskSummaries: taskSummaries))
        rebuildMessageBubbles()
    }

    private func updateBusy(_ busy: Bool) {
        sendButton.isEnabled = !busy
        saveButton.isEnabled = !busy
        deleteButton.isEnabled = !busy
        inputField.isEditable = !busy
        sendButton.setImage(UIImage(systemName: busy ? "hourglass" : "arrow.up"), for: .normal)
    }

    private func availableCredential() -> (provider: AssistantProvider, apiKey: String)? {
        let providers = [activeProvider] + AssistantProvider.allCases.filter { $0 != activeProvider }
        for provider in providers {
            if let stored = VitAlGuardAssistantKeychain.load(provider), !stored.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return (provider, stored)
            }
        }
        if let typed = keyField.text?.trimmingCharacters(in: .whitespacesAndNewlines), !typed.isEmpty {
            return (activeProvider, typed)
        }
        return nil
    }

    private func updateProviderField() {
        keyField.placeholder = activeProvider.keyPlaceholder
        keyField.accessibilityLabel = activeProvider.keyPlaceholder
    }

    private func setKeySettingsVisible(_ visible: Bool, animated: Bool) {
        guard keySettingsCard.isHidden == !visible || keySettingsHeightConstraint?.constant != (visible ? keySettingsExpandedHeight : 0) else { return }
        keySettingsCard.isHidden = false
        keySettingsHeightConstraint?.constant = visible ? keySettingsExpandedHeight : 0
        let updates = {
            self.keySettingsCard.alpha = visible ? 1 : 0
            self.view.layoutIfNeeded()
        }
        let completion: (Bool) -> Void = { _ in
            self.keySettingsCard.isHidden = !visible
        }
        if animated {
            UIView.animate(withDuration: 0.2, animations: updates, completion: completion)
        } else {
            updates()
            completion(true)
        }
    }

    @objc private func providerChanged() {
        updateProviderField()
        if VitAlGuardAssistantKeychain.load(activeProvider) != nil {
            statusLabel.text = "\(activeProvider.title) 키가 이 기기에 저장되어 있습니다."
        } else {
            statusLabel.text = "\(activeProvider.title) API 키를 입력하고 저장해 주세요."
        }
        updateUsageLabel()
    }

    @objc private func saveKeyTapped() {
        statusLabel.textColor = .secondaryLabel
        guard let key = keyField.text?.trimmingCharacters(in: .whitespacesAndNewlines), key.count >= 20 else {
            statusLabel.text = "키가 너무 짧습니다. 정확한 API 키를 입력해 주세요."
            statusLabel.textColor = .systemOrange
            return
        }

        do {
            try VitAlGuardAssistantKeychain.save(key, for: activeProvider)
            keyField.text = ""
            loadSavedState()
            statusLabel.text = "\(activeProvider.title) 키가 이 기기의 Keychain에 저장되었습니다."
            statusLabel.textColor = .systemGreen
        } catch {
            statusLabel.text = "키 저장 실패: 로컬 보안 저장에 실패했습니다."
            statusLabel.textColor = .systemRed
        }
    }

    @objc private func deleteKeyTapped() {
        do {
            try VitAlGuardAssistantKeychain.remove(activeProvider)
            loadSavedState()
            statusLabel.text = "\(activeProvider.title) 키가 삭제되었습니다."
            statusLabel.textColor = .systemOrange
            keyField.text = ""
        } catch {
            statusLabel.text = "키 삭제 실패: 키를 확인해 주세요."
            statusLabel.textColor = .systemRed
        }
    }

    @objc private func clearTapped() {
        messages.removeAll()
        seedMessagesIfNeeded()
        statusLabel.text = "대화가 초기화되었습니다."
        statusLabel.text = statusLabel.text
    }

    @objc private func focusAPIKeyTapped() {
        let willShow = keySettingsCard.isHidden
        setKeySettingsVisible(willShow, animated: true)
        if willShow {
            DispatchQueue.main.async { self.keyField.becomeFirstResponder() }
        }
    }

    @objc private func refreshConversationTapped() {
        requestCount = 0
        totalPromptTokens = 0
        totalCompletionTokens = 0
        totalTokens = 0
        updateUsageLabel()
        messages.removeAll()
        seedMessagesIfNeeded()
        statusLabel.text = "채팅이 새로고침되었습니다."
        Task { await refreshChatContract() }
    }

    @objc private func messageEditTapped() {
        isMessageEditMode.toggle()
        if !isMessageEditMode {
            selectedMessageIndexes.removeAll()
        }
        updateMessageEditControls()
        rebuildMessageBubbles()
    }

    @objc private func toggleMessageSelection(_ sender: UIButton) {
        if selectedMessageIndexes.contains(sender.tag) {
            selectedMessageIndexes.remove(sender.tag)
        } else {
            selectedMessageIndexes.insert(sender.tag)
        }
        updateMessageEditControls()
        rebuildMessageBubbles()
    }

    @objc private func selectAllMessagesTapped() {
        if selectedMessageIndexes.count == messages.count {
            selectedMessageIndexes.removeAll()
        } else {
            selectedMessageIndexes = Set(messages.indices)
        }
        updateMessageEditControls()
        rebuildMessageBubbles()
    }

    @objc private func deleteSelectedMessagesTapped() {
        guard !selectedMessageIndexes.isEmpty else { return }
        let selected = selectedMessageIndexes
        messages = messages.enumerated().compactMap { selected.contains($0.offset) ? nil : $0.element }
        selectedMessageIndexes.removeAll()
        isMessageEditMode = false
        statusLabel.text = "선택한 채팅 내역을 삭제했습니다."
        statusLabel.textColor = .secondaryLabel
        updateMessageEditControls()
        rebuildMessageBubbles()
    }

    private func updateMessageEditControls() {
        let isEditing = isMessageEditMode
        messageEditToolbar.isHidden = !isEditing
        messageEditToolbarHeightConstraint?.constant = isEditing ? 44 : 0
        messageEditButton.tintColor = isEditing ? .systemRed : .systemBlue
        selectAllMessagesButton.setTitle(selectedMessageIndexes.count == messages.count && !messages.isEmpty ? "전체 해제" : "전체 선택", for: .normal)
        deleteSelectedMessagesButton.setTitle(selectedMessageIndexes.isEmpty ? "선택 삭제" : "선택 삭제 (\(selectedMessageIndexes.count))", for: .normal)
        deleteSelectedMessagesButton.isEnabled = !selectedMessageIndexes.isEmpty
        deleteSelectedMessagesButton.alpha = selectedMessageIndexes.isEmpty ? 0.45 : 1
        view.setNeedsLayout()
    }

    @objc private func closeTapped() {
        if let onCloseRequest {
            onCloseRequest()
            return
        }

        if let nav = navigationController {
            if nav.presentingViewController != nil {
                nav.dismiss(animated: true)
            } else if nav.viewControllers.count > 1 {
                nav.popViewController(animated: true)
            }
            return
        }

        if presentingViewController != nil {
            dismiss(animated: true)
        }
    }

    @objc private func sendTapped() {
        guard let question = inputField.text?.trimmingCharacters(in: .whitespacesAndNewlines),
              !question.isEmpty,
              question != "메시지" else {
            statusLabel.text = "질문이 비어 있습니다."
            statusLabel.textColor = .systemOrange
            return
        }

        guard !vitalGuardAssistantSessionToken().isEmpty else {
            statusLabel.text = "관제 계정 로그인 세션이 필요합니다."
            statusLabel.textColor = .systemOrange
            return
        }

        let attachmentSummary = pendingAttachments.isEmpty
            ? ""
            : "\n\n첨부: \(pendingAttachments.count)개 (관제 챗봇과 동일하게 파일명·원본은 전송하지 않음)"
        appendLog("user", text: question + attachmentSummary)
        pendingAttachments.removeAll()
        rebuildAttachmentPreviews()
        restoreInputPlaceholder()
        Task { @MainActor in
            requestCount += 1
            updateUsageLabel()
        }
        updateBusy(true)
        statusLabel.text = chatContract.loadingMessage
        statusLabel.textColor = .secondaryLabel

        Task {
            await refreshChatContract()
            await requestAssistantReply(question: question)
            Task { @MainActor in
                updateBusy(false)
            }
        }
    }

    func textViewDidBeginEditing(_ textView: UITextView) {
        guard textView.text == "메시지" else { return }
        textView.text = ""
        textView.textColor = .label
    }

    func textViewDidEndEditing(_ textView: UITextView) {
        if textView.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            restoreInputPlaceholder()
        }
    }

    private func restoreInputPlaceholder() {
        inputField.text = "메시지"
        inputField.textColor = .placeholderText
    }

    @objc private func attachmentTapped() {
        let menu = UIAlertController(title: "첨부 추가", message: "사진, 동영상 또는 파일을 대화에 첨부합니다.", preferredStyle: .actionSheet)
        menu.addAction(UIAlertAction(title: "사진 또는 동영상", style: .default) { [weak self] _ in
            self?.presentPhotoVideoPicker()
        })
        menu.addAction(UIAlertAction(title: "파일 선택", style: .default) { [weak self] _ in
            self?.presentFilePicker()
        })
        menu.addAction(UIAlertAction(title: "취소", style: .cancel))
        if let popover = menu.popoverPresentationController {
            popover.sourceView = attachmentButton
            popover.sourceRect = attachmentButton.bounds
        }
        present(menu, animated: true)
    }

    private func presentPhotoVideoPicker() {
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.filter = .any(of: [.images, .videos])
        configuration.selectionLimit = 5
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        present(picker, animated: true)
    }

    private func presentFilePicker() {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = true
        present(picker, animated: true)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        let attachments = results.map { result -> AssistantAttachment in
            let provider = result.itemProvider
            let kind: AssistantAttachmentKind = provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) ? .video : .photo
            let name = provider.suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines)
            return AssistantAttachment(kind: kind, displayName: (name?.isEmpty == false ? name! : kind.title))
        }
        addAttachments(attachments)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        controller.dismiss(animated: true)
        let attachments = urls.map { url in
            AssistantAttachment(kind: attachmentKind(for: url), displayName: url.lastPathComponent)
        }
        addAttachments(attachments)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        controller.dismiss(animated: true)
    }

    private func attachmentKind(for url: URL) -> AssistantAttachmentKind {
        guard let type = UTType(filenameExtension: url.pathExtension) else { return .file }
        if type.conforms(to: .image) { return .photo }
        if type.conforms(to: .movie) { return .video }
        return .file
    }

    private func addAttachments(_ attachments: [AssistantAttachment]) {
        guard !attachments.isEmpty else { return }
        pendingAttachments.append(contentsOf: attachments)
        rebuildAttachmentPreviews()
        statusLabel.text = "첨부 \(attachments.count)개를 대화에 추가했습니다."
        statusLabel.textColor = .secondaryLabel
    }

    private func rebuildAttachmentPreviews() {
        attachmentStack.arrangedSubviews.forEach {
            attachmentStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }

        for attachment in pendingAttachments {
            let chip = UIButton(type: .system)
            var config = UIButton.Configuration.bordered()
            config.image = UIImage(systemName: attachment.kind.symbol)
            config.title = "\(attachment.displayName)  ×"
            config.imagePadding = 6
            config.baseBackgroundColor = .systemBackground
            config.baseForegroundColor = .systemBlue
            config.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 10, bottom: 7, trailing: 10)
            chip.configuration = config
            chip.tintColor = .systemBlue
            chip.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
            chip.backgroundColor = UIColor.systemBackground
            chip.layer.cornerRadius = 16
            chip.layer.borderWidth = 1 / UIScreen.main.scale
            chip.layer.borderColor = UIColor.separator.withAlphaComponent(0.5).cgColor
            chip.accessibilityLabel = "\(attachment.kind.title) \(attachment.displayName), 순서 변경 또는 제거"
            chip.accessibilityIdentifier = attachment.id.uuidString
            chip.addTarget(self, action: #selector(editAttachmentTapped(_:)), for: .touchUpInside)
            attachmentStack.addArrangedSubview(chip)
        }

        let visible = !pendingAttachments.isEmpty
        attachmentTray.isHidden = !visible
        attachmentTrayHeightConstraint?.constant = visible ? 52 : 0
        view.setNeedsLayout()
        view.layoutIfNeeded()
    }

    @objc private func editAttachmentTapped(_ sender: UIButton) {
        guard let identifier = sender.accessibilityIdentifier,
              let id = UUID(uuidString: identifier),
              let index = pendingAttachments.firstIndex(where: { $0.id == id }) else { return }

        let attachment = pendingAttachments[index]
        let menu = UIAlertController(title: attachment.displayName, message: "첨부 순서를 바꾸거나 대화에서 제거할 수 있습니다.", preferredStyle: .actionSheet)
        let moveLeft = UIAlertAction(title: "앞으로 이동", style: .default) { [weak self] _ in
            self?.moveAttachment(from: index, to: index - 1)
        }
        moveLeft.isEnabled = index > 0
        let moveRight = UIAlertAction(title: "뒤로 이동", style: .default) { [weak self] _ in
            self?.moveAttachment(from: index, to: index + 1)
        }
        moveRight.isEnabled = index < pendingAttachments.count - 1
        menu.addAction(moveLeft)
        menu.addAction(moveRight)
        menu.addAction(UIAlertAction(title: "첨부 제거", style: .destructive) { [weak self] _ in
            self?.pendingAttachments.removeAll { $0.id == id }
            self?.rebuildAttachmentPreviews()
        })
        menu.addAction(UIAlertAction(title: "취소", style: .cancel))
        if let popover = menu.popoverPresentationController {
            popover.sourceView = sender
            popover.sourceRect = sender.bounds
        }
        present(menu, animated: true)
    }

    private func moveAttachment(from sourceIndex: Int, to destinationIndex: Int) {
        guard pendingAttachments.indices.contains(sourceIndex),
              pendingAttachments.indices.contains(destinationIndex) else { return }
        let attachment = pendingAttachments.remove(at: sourceIndex)
        pendingAttachments.insert(attachment, at: destinationIndex)
        rebuildAttachmentPreviews()
    }

    @MainActor
    private func requestAssistantReply(question: String) async {
        do {
            let (answer, usage, response) = try await fetchServerAnswer(question: question)
            if let usage {
                Task { @MainActor in
                    totalPromptTokens += usage.promptTokens
                    totalCompletionTokens += usage.completionTokens
                    totalTokens += usage.totalTokens
                    updateUsageLabel()
                }
            }
            if let assignments = response.assignments, assignments.count == 1 {
                followUpWorkerIds = [assignments[0].workerId]
            } else {
                followUpWorkerIds = []
            }
            appendLog(
                "assistant",
                text: answer,
                source: response.source,
                taskSummaries: response.taskSummaries
            )
            statusLabel.text = "관제 서버 응답을 받았습니다."
            statusLabel.textColor = .systemGreen
        } catch {
            if let assistantError = error as? AssistantError {
                statusLabel.text = assistantError.userMessage
            } else {
                statusLabel.text = "네트워크 오류로 답변을 받지 못했습니다."
            }
            statusLabel.textColor = .systemRed
        }
    }

    private func fetchServerAnswer(question: String) async throws -> (String, UsageSnapshot?, AssignmentChatResponse) {
        guard let url = vitalGuardAssistantEndpoint() else {
            throw AssistantError.invalidResponse
        }
        let token = vitalGuardAssistantSessionToken()
        guard !token.isEmpty else {
            throw AssistantError.httpError(401)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.addValue("medium", forHTTPHeaderField: "x-assignment-chat-usage-level")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["message": question, "followUpWorkerIds": followUpWorkerIds])

        let session = URLSession(configuration: .ephemeral)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AssistantError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw AssistantError.httpError(http.statusCode)
        }
        guard let response = try? JSONDecoder().decode(AssignmentChatResponse.self, from: data),
              response.ok,
              let reply = response.reply,
              !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AssistantError.invalidResponse
        }
        return (reply.trimmingCharacters(in: .whitespacesAndNewlines), nil, response)
    }

    @MainActor
    private func refreshChatContract() async {
        guard let endpoint = vitalGuardAssistantEndpoint(), !vitalGuardAssistantSessionToken().isEmpty else { return }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.timeoutInterval = 10
        request.setValue("Bearer \(vitalGuardAssistantSessionToken())", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession(configuration: .ephemeral).data(for: request),
              let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode),
              let payload = try? JSONDecoder().decode(ChatContractPayload.self, from: data),
              payload.ok else { return }
        chatContract = payload.contract
        if messages.count == 1, messages[0].role == "system" {
            messages[0] = ChatMessage(role: "system", content: chatContract.welcomeMessage)
            rebuildMessageBubbles()
        }
    }

    private struct ChatContractPayload: Decodable {
        let ok: Bool
        let contract: AssignmentChatContract
    }

    private struct UsageSnapshot {
        let promptTokens: Int
        let completionTokens: Int
        let totalTokens: Int
    }

}

private enum AssistantError: Error {
    case keychainSaveFailed(OSStatus)
    case keychainDeleteFailed(OSStatus)
    case invalidResponse
    case httpError(Int)
    case emptyReply
    case serverMessage(String)

    var userMessage: String {
        switch self {
        case .keychainSaveFailed:
            return "로컬 보안 저장 실패. 기기 권한을 확인해 주세요."
        case .keychainDeleteFailed:
            return "키 삭제를 완료하지 못했습니다."
        case .invalidResponse:
            return "응답 형식을 처리할 수 없습니다."
        case .emptyReply:
            return "답변이 비어 있습니다."
        case .serverMessage(let msg):
            if msg.contains("rate_limit") {
                return "요청 한도 초과입니다. 잠시 후 다시 시도해 주세요."
            }
            if msg.contains("invalid_api_key") || msg.contains("Incorrect API key") || msg.contains("Invalid API key") {
                return "API 키가 유효하지 않습니다."
            }
            return "요청 실패: \(msg)"
        case .httpError(let code):
            switch code {
            case 401:
                return "관제 계정 로그인이 필요합니다(401). 다시 로그인해 주세요."
            case 429:
                return "요청이 과도합니다(429). 잠시 후 재시도해 주세요."
            default:
                return "API 응답 오류(\(code))."
            }
        }
    }
}

private struct HyperCLOVARequest: Codable {
    let messages: [ChatMessage]
    let temperature: Double
    let topP: Double
    let maxTokens: Int
}

private struct OpenAIRequest: Codable {
    let model: String
    let messages: [ChatMessage]
    let temperature: Double
    let maxTokens: Int

    enum CodingKeys: String, CodingKey {
        case model
        case messages
        case temperature
        case maxTokens = "max_tokens"
    }
}

private struct ChatReply: Codable {
    let choices: [ChatChoice]
}

private struct HyperCLOVAReply: Codable {
    let result: HyperCLOVAReplyResult?
}

private struct HyperCLOVAReplyResult: Codable {
    let message: ReplyMessage?
}

private struct ChatChoice: Codable {
    let message: ReplyMessage
}

private struct ReplyMessage: Codable {
    let role: String
    let content: String
}

private struct ChatErrorPayload: Codable {
    let error: ChatErrorMessage?
}

private struct ChatErrorMessage: Codable {
    let message: String
}
