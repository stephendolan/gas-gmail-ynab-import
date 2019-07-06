// Convert a float number to YNAB's weird milliunit format
//
// @see https://api.youneedabudget.com/#formats
function toMilliunit(amount) {
  var milliunitString = Utilities.formatString("%07.3f", amount);
  milliunitString = milliunitString.replace(/\./g, "");

  return milliunitString;
}

// Send a POST request to the YNAB transactions route
function sendTransactionToYNAB(amount, payee, memo, accountId) {
  var budgetId = UserProperties.getProperty("budget_id");

  var apiToken = UserProperties.getProperty("api_token");
  var baseUrl = "https://api.youneedabudget.com/v1/";
  var transactionUrl = baseUrl + "budgets/" + budgetId + "/transactions";

  var today = new Date().toISOString();

  Logger.log(accountId);

  var data = {
    transaction: {
      account_id: accountId,
      date: today,
      amount: toMilliunit(amount),
      payee_name: payee,
      memo: memo,
      category: null,
      cleared: "uncleared",
      flag_color: "green"
    }
  };

  var headers = {
    Authorization: "Bearer " + apiToken
  };

  var options = {
    method: "post",
    contentType: "application/json",
    headers: headers,
    payload: JSON.stringify(data)
  };

  UrlFetchApp.fetch(transactionUrl, options);
}

// Parse the amount of an Amazon purchase from the confirmation email.
function parseAmazonPurchaseAmount(message) {
  var plainBody = message.getPlainBody();
  var amountRegex = /Order Total: \$(\d+(?:\.\d{2})?)/;
  var amountMatches = amountRegex.exec(plainBody);

  if (amountMatches === null) {
    return null;
  }

  return amountMatches[1];
}

// For every Thread in the inbox label:
// - send the transaction to YNAB
// - remove the inbox label
// - add the processed label
function processInbox() {
  var processedLabel = GmailApp.getUserLabelByName(
    UserProperties.getProperty("processed_label")
  );
  var inboxLabel = GmailApp.getUserLabelByName(
    UserProperties.getProperty("inbox_label")
  );

  inboxLabel.getThreads().forEach(function(thread) {
    var subject = thread.getFirstMessageSubject();

    var sentMoneyRegex = /You sent \$(\d+(?:\.\d{2})?) to (?:(.*) for (.*)|(.*))/;
    var receivedMoneyRegex = /(.*) sent you \$(\d+(?:\.\d{2})?)(?: for (.*))?/;
    var cashCardPurchaseRegex = /You spent \$(\d+(?:\.\d{2})?) at (?:(.*)\. Your.*|(.*))/;
    var amazonPurchaseRegex = /Your Amazon.* order of (.*)/;

    var sentMoneyMatches = sentMoneyRegex.exec(subject);
    var receivedMoneyMatches = receivedMoneyRegex.exec(subject);
    var cashCardPurchaseMatches = cashCardPurchaseRegex.exec(subject);
    var amazonPurchaseMatches = amazonPurchaseRegex.exec(subject);

    var amountMultiplier = 1;
    var memo = "";
    var payee = "";
    var amountString = "";
    var accountId = "";

    if (sentMoneyMatches !== null) {
      amountMultiplier = -1;
      amountString = sentMoneyMatches[1];
      payee = sentMoneyMatches[2] || sentMoneyMatches[4];
      memo = sentMoneyMatches[3] || "No Memo Found";
      accountId = UserProperties.getProperty("checking_account_id");
    } else if (receivedMoneyMatches !== null) {
      amountMultiplier = 1;
      payee = receivedMoneyMatches[1];
      amountString = receivedMoneyMatches[2];
      memo = receivedMoneyMatches[3] || "No Memo Found";
      accountId = UserProperties.getProperty("checking_account_id");
    } else if (cashCardPurchaseMatches !== null) {
      amountMultiplier = -1;
      amountString = cashCardPurchaseMatches[1];
      payee = cashCardPurchaseMatches[2];
      memo = "Fill me in!";
      accountId = UserProperties.getProperty("square_cash_account_id");
    } else if (amazonPurchaseMatches !== null) {
      amountMultiplier = -1;
      amountString = parseAmazonPurchaseAmount(thread.getMessages()[0]);
      payee = "Amazon";
      accountId = UserProperties.getProperty("amazon_visa_account_id");
      memo = amazonPurchaseMatches[1];
    } else {
      Logger.log("Unable to find a valid regular expression match");
      Logger.log(subject);
      return null;
    }

    if (
      accountId === null ||
      amountString === null ||
      payee === null ||
      memo === null
    ) {
      return null;
    }

    var amount = amountMultiplier * parseFloat(amountString);

    sendTransactionToYNAB(amount, payee, memo, accountId);

    thread.removeLabel(inboxLabel);
    thread.markRead();
    thread.addLabel(processedLabel);
  });
}

// The main entrypoint for the script.
//
// @author Stephen Dolan
//
// @user_property [String] budget_id the ID of the YNAB budget to create transactions within
// @user_property [String] checking_account_id the ID of the YNAB checking account to create transactions within
// @user_property [String] square_cash_account_id the ID of the YNAB Square Cash Card account to create transactions within
// @user_property [String] api_key the YNAB API key for authenticating requests, acquired from https://api.youneedabudget.com
// @user_property [String] inbox_label the label to retrieve unprocessed Cash emails from
// @user_property [String] processed_label the label to send processed Cash emails to
function main() {
  processInbox();
}
